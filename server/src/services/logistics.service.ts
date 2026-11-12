import { prisma } from '../utils/prisma.js';
import { httpError, nextDocNumber, requireString, serialize, shortId, toDec } from '../utils/helpers.js';
import type { AuthUser } from '../types/express/index.js';
import { writeAudit } from './audit.service.js';
import * as branchAccess from './branch-access.service.js';
import * as warehouseFulfilment from './warehouse-fulfilment.service.js';

const vehicleInclude = {
  driver: { select: { id: true, fullName: true, code: true, phone: true } }
};

const deliveryInclude = {
  customer: { select: { id: true, name: true, phone: true, addressLine1: true, city: true } },
  warehouse: { select: { id: true, name: true, code: true } },
  branch: { select: { id: true, name: true, code: true } },
  vehicle: { select: { id: true, name: true, plateNumber: true, code: true } },
  salesInvoice: { select: { id: true, invoiceNumber: true, status: true } },
  fulfilment: { select: { id: true, fulfilmentNumber: true, status: true } },
  items: {
    include: {
      product: { select: { id: true, name: true, sku: true } },
      variant: { select: { id: true, name: true, sku: true } }
    }
  }
};

async function nextDeliveryNumber(businessId: string) {
  return nextDocNumber(prisma.deliveryOrder, businessId, 'deliveryNumber', 'DEL', 5);
}

async function getDeliveryOrThrow(businessId: string, id: string) {
  const row = await prisma.deliveryOrder.findFirst({
    where: { id, businessId },
    include: deliveryInclude
  });
  if (!row) throw httpError(404, 'Delivery order not found');
  return row;
}

// ─── Vehicles ────────────────────────────────────────────────────────────────

export async function listVehicles(businessId: string) {
  const rows = await prisma.vehicle.findMany({
    where: { businessId },
    include: vehicleInclude,
    orderBy: { name: 'asc' }
  });
  return serialize(rows);
}

export async function createVehicle(user: AuthUser, body: Record<string, any>) {
  const name = requireString(body.name, 'name');
  const driverEmployeeId = body.driver_employee_id || body.driverEmployeeId || null;

  if (driverEmployeeId) {
    const emp = await prisma.employee.findFirst({
      where: { id: driverEmployeeId, businessId: user.businessId }
    });
    if (!emp) throw httpError(400, 'Invalid driver_employee_id');
  }

  const created = await prisma.vehicle.create({
    data: {
      id: shortId('veh'),
      businessId: user.businessId,
      code: body.code || null,
      name,
      plateNumber: body.plate_number || body.plateNumber || null,
      capacity:
        body.capacity != null && body.capacity !== ''
          ? toDec(Number(body.capacity))
          : null,
      driverEmployeeId,
      status: body.status || 'available',
      notes: body.notes || null
    },
    include: vehicleInclude
  });

  await writeAudit({
    user,
    action: 'create',
    module: 'distribution',
    entityType: 'Vehicle',
    entityId: created.id,
    summary: `Created vehicle ${created.name}`
  });

  return serialize(created);
}

export async function updateVehicle(user: AuthUser, id: string, body: Record<string, any>) {
  const existing = await prisma.vehicle.findFirst({
    where: { id, businessId: user.businessId }
  });
  if (!existing) throw httpError(404, 'Vehicle not found');

  const driverEmployeeId =
    body.driver_employee_id !== undefined || body.driverEmployeeId !== undefined
      ? body.driver_employee_id ?? body.driverEmployeeId ?? null
      : undefined;

  if (driverEmployeeId) {
    const emp = await prisma.employee.findFirst({
      where: { id: driverEmployeeId, businessId: user.businessId }
    });
    if (!emp) throw httpError(400, 'Invalid driver_employee_id');
  }

  const updated = await prisma.vehicle.update({
    where: { id },
    data: {
      ...(body.name != null ? { name: requireString(body.name, 'name') } : {}),
      ...(body.code !== undefined ? { code: body.code || null } : {}),
      ...(body.plate_number !== undefined || body.plateNumber !== undefined
        ? { plateNumber: body.plate_number ?? body.plateNumber ?? null }
        : {}),
      ...(body.capacity !== undefined
        ? {
            capacity:
              body.capacity != null && body.capacity !== ''
                ? toDec(Number(body.capacity))
                : null
          }
        : {}),
      ...(driverEmployeeId !== undefined ? { driverEmployeeId } : {}),
      ...(body.status != null ? { status: String(body.status) } : {}),
      ...(body.notes !== undefined ? { notes: body.notes || null } : {})
    },
    include: vehicleInclude
  });

  await writeAudit({
    user,
    action: 'update',
    module: 'distribution',
    entityType: 'Vehicle',
    entityId: updated.id,
    summary: `Updated vehicle ${updated.name}`
  });

  return serialize(updated);
}

// ─── Deliveries ──────────────────────────────────────────────────────────────

export async function listDeliveries(
  user: AuthUser,
  status?: string,
  opts?: { branchId?: string | null; allowConsolidated?: boolean }
) {
  const scope = await branchAccess.branchScopeWhere(user, {
    branchId: opts?.branchId,
    allowConsolidated: opts?.allowConsolidated
  });
  const rows = await prisma.deliveryOrder.findMany({
    where: { businessId: user.businessId, ...scope, ...(status ? { status } : {}) },
    include: deliveryInclude,
    orderBy: { createdAt: 'desc' }
  });
  return serialize(rows);
}

export async function getDelivery(businessId: string, id: string) {
  return serialize(await getDeliveryOrThrow(businessId, id));
}

export async function createDelivery(user: AuthUser, body: Record<string, any>) {
  const salesInvoiceId = body.sales_invoice_id || body.salesInvoiceId || null;
  let customerId = body.customer_id || body.customerId || null;
  let warehouseId = body.warehouse_id || body.warehouseId || null;
  let branchId = body.branch_id || body.branchId || null;
  let addressLine1 = body.address_line1 || body.addressLine1 || null;
  let city = body.city || null;
  let itemsInput: { productId: string; variantId: string | null; quantity: number; notes: string | null }[] =
    [];

  if (salesInvoiceId) {
    const invoice = await prisma.salesInvoice.findFirst({
      where: { id: salesInvoiceId, businessId: user.businessId },
      include: { items: true, customer: true }
    });
    if (!invoice) throw httpError(400, 'Invalid sales_invoice_id');
    customerId = invoice.customerId;
    warehouseId = invoice.warehouseId;
    branchId = invoice.branchId;
    addressLine1 = addressLine1 || invoice.customer.addressLine1;
    city = city || invoice.customer.city;
    itemsInput = invoice.items.map((it) => ({
      productId: it.productId,
      variantId: it.variantId,
      quantity: Number(it.quantity),
      notes: null
    }));
  } else {
    customerId = requireString(customerId, 'customer_id');
    warehouseId = requireString(warehouseId, 'warehouse_id');
    const rawItems: any[] = Array.isArray(body.items) ? body.items : [];
    if (!rawItems.length) throw httpError(400, 'items array is required when sales_invoice_id is omitted');
    for (const [i, line] of rawItems.entries()) {
      const productId = requireString(line.product_id || line.productId, `items[${i}].product_id`);
      const qty = Number(line.quantity);
      if (!qty || qty <= 0) throw httpError(400, `items[${i}].quantity must be > 0`);
      itemsInput.push({
        productId,
        variantId: line.variant_id || line.variantId || null,
        quantity: qty,
        notes: line.notes || null
      });
    }
  }

  if (!customerId || !warehouseId) {
    throw httpError(400, 'customer_id and warehouse_id are required');
  }

  const resolvedBranchId = await branchAccess.resolveWriteBranchId(
    user,
    branchId || body.branch_id || body.branchId || user.activeBranchId
  );
  const warehouse = await branchAccess.resolveWarehouseInBranch(
    user.businessId,
    warehouseId,
    resolvedBranchId
  );
  const customer = await prisma.customer.findFirst({
    where: { id: customerId, businessId: user.businessId }
  });
  if (!customer) throw httpError(400, 'Invalid customer_id');

  for (const [i, line] of itemsInput.entries()) {
    const product = await prisma.product.findFirst({
      where: { id: line.productId, businessId: user.businessId }
    });
    if (!product) throw httpError(400, `items[${i}] invalid product_id`);
  }

  const vehicleId = body.vehicle_id || body.vehicleId || null;
  if (vehicleId) {
    const vehicle = await prisma.vehicle.findFirst({
      where: { id: vehicleId, businessId: user.businessId }
    });
    if (!vehicle) throw httpError(400, 'Invalid vehicle_id');
  }

  const deliveryNumber =
    body.delivery_number || body.deliveryNumber || (await nextDeliveryNumber(user.businessId));

  const created = await prisma.deliveryOrder.create({
    data: {
      id: shortId('del'),
      businessId: user.businessId,
      deliveryNumber,
      salesInvoiceId,
      customerId,
      warehouseId: warehouse.id,
      branchId: resolvedBranchId,
      vehicleId,
      driverName: body.driver_name || body.driverName || null,
      scheduledDate: body.scheduled_date || body.scheduledDate
        ? new Date(body.scheduled_date || body.scheduledDate)
        : null,
      status: 'draft',
      addressLine1: addressLine1 || customer.addressLine1,
      city: city || customer.city,
      notes: body.notes || null,
      createdById: user.id,
      items: {
        create: itemsInput.map((it) => ({
          id: shortId('dei'),
          productId: it.productId,
          variantId: it.variantId,
          quantity: toDec(it.quantity),
          notes: it.notes
        }))
      }
    },
    include: deliveryInclude
  });

  await writeAudit({
    user,
    action: 'create',
    module: 'distribution',
    entityType: 'DeliveryOrder',
    entityId: created.id,
    summary: `Created delivery ${created.deliveryNumber}`
  });

  return serialize(created);
}

export async function scheduleDelivery(user: AuthUser, id: string, body: Record<string, any> = {}) {
  const delivery = await getDeliveryOrThrow(user.businessId, id);
  if (!['draft', 'scheduled'].includes(delivery.status)) {
    throw httpError(400, 'Only draft or scheduled deliveries can be scheduled');
  }

  const scheduledDate =
    body.scheduled_date || body.scheduledDate
      ? new Date(body.scheduled_date || body.scheduledDate)
      : delivery.scheduledDate || new Date();

  const vehicleId =
    body.vehicle_id !== undefined || body.vehicleId !== undefined
      ? body.vehicle_id ?? body.vehicleId ?? null
      : delivery.vehicleId;

  if (vehicleId) {
    const vehicle = await prisma.vehicle.findFirst({
      where: { id: vehicleId, businessId: user.businessId }
    });
    if (!vehicle) throw httpError(400, 'Invalid vehicle_id');
  }

  const updated = await prisma.deliveryOrder.update({
    where: { id },
    data: {
      status: 'scheduled',
      scheduledDate,
      vehicleId,
      ...(body.driver_name !== undefined || body.driverName !== undefined
        ? { driverName: body.driver_name ?? body.driverName ?? null }
        : {}),
      ...(body.notes !== undefined ? { notes: body.notes || null } : {})
    },
    include: deliveryInclude
  });

  await writeAudit({
    user,
    action: 'schedule',
    module: 'distribution',
    entityType: 'DeliveryOrder',
    entityId: updated.id,
    summary: `Scheduled delivery ${updated.deliveryNumber}`
  });

  return serialize(updated);
}

export async function dispatchDelivery(user: AuthUser, id: string, body: Record<string, any> = {}) {
  const delivery = await getDeliveryOrThrow(user.businessId, id);
  if (delivery.fulfilmentId) {
    await warehouseFulfilment.dispatchTask(user, delivery.fulfilmentId, body);
    return getDelivery(user.businessId, id);
  }
  if (!['draft', 'scheduled'].includes(delivery.status)) {
    throw httpError(400, 'Only draft or scheduled deliveries can be dispatched');
  }

  const vehicleId =
    body.vehicle_id !== undefined || body.vehicleId !== undefined
      ? body.vehicle_id ?? body.vehicleId ?? null
      : delivery.vehicleId;

  if (vehicleId) {
    const vehicle = await prisma.vehicle.findFirst({
      where: { id: vehicleId, businessId: user.businessId }
    });
    if (!vehicle) throw httpError(400, 'Invalid vehicle_id');
  }

  const updated = await prisma.deliveryOrder.update({
    where: { id },
    data: {
      status: 'dispatched',
      dispatchedAt: new Date(),
      vehicleId,
      ...(body.driver_name !== undefined || body.driverName !== undefined
        ? { driverName: body.driver_name ?? body.driverName ?? null }
        : {})
    },
    include: deliveryInclude
  });

  await writeAudit({
    user,
    action: 'dispatch',
    module: 'distribution',
    entityType: 'DeliveryOrder',
    entityId: updated.id,
    summary: `Dispatched delivery ${updated.deliveryNumber}`
  });

  return serialize(updated);
}

export async function markDelivered(user: AuthUser, id: string, body: Record<string, any> = {}) {
  const delivery = await getDeliveryOrThrow(user.businessId, id);
  if (delivery.fulfilmentId) {
    await warehouseFulfilment.deliverTask(user, delivery.fulfilmentId, body);
    return getDelivery(user.businessId, id);
  }
  if (!['dispatched', 'scheduled'].includes(delivery.status)) {
    throw httpError(400, 'Only dispatched or scheduled deliveries can be marked delivered');
  }

  const updated = await prisma.deliveryOrder.update({
    where: { id },
    data: {
      status: 'delivered',
      deliveredAt: new Date(),
      deliveredById: user.id,
      receivedBy: body.received_by || body.receivedBy || null,
      podReference: body.pod_reference || body.podReference || null,
      podNotes: body.pod_notes || body.podNotes || null,
      ...(delivery.dispatchedAt ? {} : { dispatchedAt: new Date() })
    },
    include: deliveryInclude
  });

  await writeAudit({
    user,
    action: 'deliver',
    module: 'distribution',
    entityType: 'DeliveryOrder',
    entityId: updated.id,
    summary: `Delivered ${updated.deliveryNumber}`
  });

  return serialize(updated);
}

export async function cancelDelivery(user: AuthUser, id: string, body: Record<string, any> = {}) {
  const delivery = await getDeliveryOrThrow(user.businessId, id);
  if (['delivered', 'cancelled'].includes(delivery.status)) {
    throw httpError(400, `Cannot cancel a ${delivery.status} delivery`);
  }
  if (delivery.fulfilmentId) {
    // Goods come back to the warehouse: the order keeps its reservation and can be picked again.
    await warehouseFulfilment.returnDispatched(user, delivery.fulfilmentId, body.notes || 'Delivery cancelled');
  }

  const updated = await prisma.deliveryOrder.update({
    where: { id },
    data: {
      status: 'cancelled',
      notes: body.notes
        ? `${delivery.notes ? delivery.notes + '\n' : ''}Cancel: ${body.notes}`
        : delivery.notes
    },
    include: deliveryInclude
  });

  await writeAudit({
    user,
    action: 'cancel',
    module: 'distribution',
    entityType: 'DeliveryOrder',
    entityId: updated.id,
    summary: `Cancelled delivery ${updated.deliveryNumber}`
  });

  return serialize(updated);
}
