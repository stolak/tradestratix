import { prisma } from '../utils/prisma.js';
import {
  httpError,
  nextDocNumber,
  requireString,
  roundMoney,
  serialize,
  shortId,
  toDec
} from '../utils/helpers.js';
import type { AuthUser } from '../types/express/index.js';
import { writeAudit } from './audit.service.js';
import { convertToBaseQty, createStockMovement } from './inventory.service.js';
import { createJournal, getDefaultAccountMap } from './accounting.service.js';
import * as branchAccess from './branch-access.service.js';
import {
  applySupplierPaymentInTx,
  autoAllocateBills,
  consumePrepaidAgainstBillBalance,
  supplierPrepaidCredit
} from './supplier-payment.service.js';

type BranchListOpts = {
  branchId?: string | null;
  allowConsolidated?: boolean;
};

async function productAllowedUomIds(
  productId: string,
  baseUomId: string,
  purchaseUomId: string | null | undefined
) {
  const conversions = await prisma.productUnitConversion.findMany({
    where: { productId }
  });
  const ids = new Set<string>([baseUomId]);
  if (purchaseUomId) ids.add(purchaseUomId);
  for (const c of conversions) {
    ids.add(c.fromUomId);
    ids.add(c.toUomId);
  }
  return ids;
}

const poInclude = {
  supplier: true,
  warehouse: true,
  items: {
    include: { product: true, variant: true, uom: true },
    orderBy: { id: 'asc' as const }
  }
};

const grnInclude = {
  supplier: true,
  warehouse: true,
  purchaseOrder: true,
  items: {
    include: { product: true, variant: true, uom: true },
    orderBy: { id: 'asc' as const }
  },
  bill: true
};

async function nextPoNumber(businessId: string) {
  return nextDocNumber(prisma.purchaseOrder, businessId, 'poNumber', 'PO', 5);
}

async function nextGrnNumber(businessId: string) {
  return nextDocNumber(prisma.goodsReceiptNote, businessId, 'grnNumber', 'GRN', 5);
}

async function nextBillNumber(businessId: string) {
  return nextDocNumber(prisma.supplierBill, businessId, 'billNumber', 'BILL', 5);
}

function addDays(date: Date, days: number) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

// ─── Purchase Orders ─────────────────────────────────────────────────────────

export async function listPurchaseOrders(
  user: AuthUser,
  status?: string,
  opts?: BranchListOpts
) {
  const scope = await branchAccess.branchScopeWhere(user, {
    branchId: opts?.branchId,
    allowConsolidated: opts?.allowConsolidated
  });
  const rows = await prisma.purchaseOrder.findMany({
    where: { businessId: user.businessId, ...scope, ...(status ? { status } : {}) },
    include: poInclude,
    orderBy: { createdAt: 'desc' }
  });
  return serialize(rows);
}

export async function getPurchaseOrder(businessId: string, id: string) {
  const row = await prisma.purchaseOrder.findFirst({
    where: { id, businessId },
    include: { ...poInclude, receipts: { include: { items: true } } }
  });
  if (!row) throw httpError(404, 'Purchase order not found');
  return serialize(row);
}

export async function createPurchaseOrder(user: AuthUser, body: Record<string, any>) {
  const supplierId = requireString(body.supplier_id || body.supplierId, 'supplier_id');
  const warehouseId = requireString(body.warehouse_id || body.warehouseId, 'warehouse_id');
  const itemsInput: any[] = Array.isArray(body.items) ? body.items : [];
  if (!itemsInput.length) throw httpError(400, 'At least one PO line is required');

  const supplier = await prisma.supplier.findFirst({
    where: { id: supplierId, businessId: user.businessId, status: 'active' }
  });
  if (!supplier) throw httpError(400, 'Invalid supplier_id');

  const branchId = await branchAccess.resolveWriteBranchId(
    user,
    body.branch_id || body.branchId || user.activeBranchId
  );
  const warehouse = await branchAccess.resolveWarehouseInBranch(
    user.businessId,
    warehouseId,
    branchId
  );

  const lines: {
    productId: string;
    variantId: string | null;
    uomId: string | null;
    quantityOrdered: number;
    unitCost: number;
    lineTotal: number;
    notes: string | null;
  }[] = [];

  for (const [i, item] of itemsInput.entries()) {
    const productId = item.product_id || item.productId;
    if (!productId) throw httpError(400, `items[${i}].product_id is required`);
    const product = await prisma.product.findFirst({
      where: { id: productId, businessId: user.businessId },
      include: { variants: true, conversions: true }
    });
    if (!product) throw httpError(400, `items[${i}] product not found`);

    let variantId = item.variant_id || item.variantId || null;
    if (!variantId) {
      const def = product.variants.find((v) => v.isDefault) || product.variants[0];
      variantId = def?.id || null;
    }
    const qty = Number(item.quantity ?? item.quantity_ordered ?? item.quantityOrdered);
    const unitCost = Number(item.unit_cost ?? item.unitCost ?? product.defaultPurchaseCost ?? 0);
    if (!qty || qty <= 0) throw httpError(400, `items[${i}].quantity must be > 0`);
    if (unitCost < 0) throw httpError(400, `items[${i}].unit_cost cannot be negative`);

    const allowed = await productAllowedUomIds(
      product.id,
      product.baseUomId,
      product.purchaseUomId
    );
    const uomId = item.uom_id || item.uomId || product.purchaseUomId || product.baseUomId;
    if (!uomId || !allowed.has(uomId)) {
      throw httpError(
        400,
        `items[${i}].uom_id must be the product base UoM, purchase UoM, or a packaging conversion`
      );
    }

    lines.push({
      productId,
      variantId,
      uomId,
      quantityOrdered: qty,
      unitCost,
      lineTotal: roundMoney(qty * unitCost),
      notes: item.notes || null
    });
  }

  const subtotal = roundMoney(lines.reduce((s, l) => s + l.lineTotal, 0));
  const taxAmount = roundMoney(Number(body.tax_amount ?? body.taxAmount ?? 0));
  const totalAmount = roundMoney(subtotal + taxAmount);
  const poNumber = body.po_number || body.poNumber || (await nextPoNumber(user.businessId));

  const created = await prisma.purchaseOrder.create({
    data: {
      id: shortId('po'),
      businessId: user.businessId,
      supplierId,
      warehouseId: warehouse.id,
      branchId,
      poNumber,
      status: 'draft',
      orderDate: body.order_date || body.orderDate ? new Date(body.order_date || body.orderDate) : new Date(),
      expectedDate:
        body.expected_date || body.expectedDate
          ? new Date(body.expected_date || body.expectedDate)
          : null,
      notes: body.notes || null,
      subtotal: toDec(subtotal),
      taxAmount: toDec(taxAmount),
      totalAmount: toDec(totalAmount),
      createdById: user.id,
      items: {
        create: lines.map((l) => ({
          id: shortId('poi'),
          productId: l.productId,
          variantId: l.variantId,
          uomId: l.uomId,
          quantityOrdered: toDec(l.quantityOrdered),
          unitCost: toDec(l.unitCost),
          lineTotal: toDec(l.lineTotal),
          notes: l.notes
        }))
      }
    },
    include: poInclude
  });

  await writeAudit({
    user,
    action: 'create',
    module: 'purchases',
    entityType: 'PurchaseOrder',
    entityId: created.id,
    summary: `Created PO ${created.poNumber}`
  });
  return serialize(created);
}

export async function submitPurchaseOrder(user: AuthUser, id: string) {
  const po = await prisma.purchaseOrder.findFirst({
    where: { id, businessId: user.businessId },
    include: { items: true }
  });
  if (!po) throw httpError(404, 'Purchase order not found');
  if (po.status !== 'draft') throw httpError(400, 'Only draft POs can be submitted');
  if (!po.items.length) throw httpError(400, 'PO has no lines');

  const updated = await prisma.purchaseOrder.update({
    where: { id },
    data: { status: 'pending_approval' },
    include: poInclude
  });
  await writeAudit({
    user,
    action: 'edit',
    module: 'purchases',
    entityType: 'PurchaseOrder',
    entityId: id,
    summary: `Submitted PO ${updated.poNumber} for approval`
  });
  return serialize(updated);
}

export async function approvePurchaseOrder(user: AuthUser, id: string) {
  const po = await prisma.purchaseOrder.findFirst({
    where: { id, businessId: user.businessId }
  });
  if (!po) throw httpError(404, 'Purchase order not found');
  if (!['draft', 'pending_approval'].includes(po.status)) {
    throw httpError(400, 'PO cannot be approved in its current status');
  }

  const updated = await prisma.purchaseOrder.update({
    where: { id },
    data: {
      status: 'approved',
      approvedById: user.id,
      approvedAt: new Date()
    },
    include: poInclude
  });
  await writeAudit({
    user,
    action: 'approve',
    module: 'purchases',
    entityType: 'PurchaseOrder',
    entityId: id,
    summary: `Approved PO ${updated.poNumber}`
  });
  return serialize(updated);
}

export async function cancelPurchaseOrder(user: AuthUser, id: string) {
  const po = await prisma.purchaseOrder.findFirst({
    where: { id, businessId: user.businessId }
  });
  if (!po) throw httpError(404, 'Purchase order not found');
  if (['received', 'cancelled'].includes(po.status)) {
    throw httpError(400, 'PO cannot be cancelled');
  }
  if (po.status === 'partially_received') {
    throw httpError(400, 'Partially received POs cannot be cancelled');
  }

  const updated = await prisma.purchaseOrder.update({
    where: { id },
    data: { status: 'cancelled' },
    include: poInclude
  });
  await writeAudit({
    user,
    action: 'edit',
    module: 'purchases',
    entityType: 'PurchaseOrder',
    entityId: id,
    summary: `Cancelled PO ${updated.poNumber}`
  });
  return serialize(updated);
}

// ─── Goods Receipt (posts stock + AP) ────────────────────────────────────────

export async function listGoodsReceipts(user: AuthUser, opts?: BranchListOpts) {
  const scope = await branchAccess.branchScopeWhere(user, {
    branchId: opts?.branchId,
    allowConsolidated: opts?.allowConsolidated
  });
  const rows = await prisma.goodsReceiptNote.findMany({
    where: { businessId: user.businessId, ...scope },
    include: grnInclude,
    orderBy: { createdAt: 'desc' }
  });
  return serialize(rows);
}

export async function getGoodsReceipt(businessId: string, id: string) {
  const row = await prisma.goodsReceiptNote.findFirst({
    where: { id, businessId },
    include: grnInclude
  });
  if (!row) throw httpError(404, 'Goods receipt not found');
  return serialize(row);
}

/**
 * Create and immediately post a GRN:
 * stock receive per line → supplier bill → Dr Inventory / Cr AP journal.
 */
export async function receiveAgainstPurchaseOrder(user: AuthUser, body: Record<string, any>) {
  const poId = requireString(body.purchase_order_id || body.purchaseOrderId, 'purchase_order_id');
  const itemsInput: any[] = Array.isArray(body.items) ? body.items : [];
  if (!itemsInput.length) throw httpError(400, 'Receipt items are required');

  const po = await prisma.purchaseOrder.findFirst({
    where: { id: poId, businessId: user.businessId },
    include: { items: true, supplier: true }
  });
  if (!po) throw httpError(404, 'Purchase order not found');
  if (!['approved', 'partially_received'].includes(po.status)) {
    throw httpError(400, 'PO must be approved (or partially received) before GRN');
  }

  const branchId = await branchAccess.resolveWriteBranchId(
    user,
    body.branch_id || body.branchId || (po as any).branchId || user.activeBranchId
  );
  const warehouseId = body.warehouse_id || body.warehouseId || po.warehouseId;
  const warehouse = await branchAccess.resolveWarehouseInBranch(
    user.businessId,
    warehouseId,
    branchId
  );

  const accountMap = await getDefaultAccountMap(user.businessId);
  if (!accountMap.inventory || !accountMap.accounts_payable) {
    throw httpError(400, 'Default inventory and accounts_payable accounts must be configured');
  }

  type RecLine = {
    purchaseOrderItemId: string;
    productId: string;
    variantId: string | null;
    uomId: string | null;
    quantity: number;
    unitCost: number;
    lineTotal: number;
    batchNumber: string | null;
    expiryDate: string | null;
    manufacturingDate: string | null;
  };

  const lines: RecLine[] = [];
  for (const [i, item] of itemsInput.entries()) {
    const poiId = item.purchase_order_item_id || item.purchaseOrderItemId;
    if (!poiId) throw httpError(400, `items[${i}].purchase_order_item_id is required`);
    const poi = po.items.find((x) => x.id === poiId);
    if (!poi) throw httpError(400, `items[${i}] is not on this PO`);

    const ordered = Number(poi.quantityOrdered);
    const already = Number(poi.quantityReceived);
    const qty = Number(item.quantity);
    if (!qty || qty <= 0) throw httpError(400, `items[${i}].quantity must be > 0`);
    if (already + qty > ordered + 1e-9) {
      throw httpError(
        400,
        `items[${i}] exceeds remaining ordered qty (${ordered - already})`
      );
    }

    const unitCost = Number(item.unit_cost ?? item.unitCost ?? poi.unitCost);
    lines.push({
      purchaseOrderItemId: poi.id,
      productId: poi.productId,
      variantId: poi.variantId,
      uomId: poi.uomId,
      quantity: qty,
      unitCost,
      lineTotal: roundMoney(qty * unitCost),
      batchNumber: item.batch_number || item.batchNumber || null,
      expiryDate: item.expiry_date || item.expiryDate || null,
      manufacturingDate: item.manufacturing_date || item.manufacturingDate || null
    });
  }

  const subtotal = roundMoney(lines.reduce((s, l) => s + l.lineTotal, 0));
  const grnId = shortId('grn');
  const billId = shortId('bill');
  const grnNumber = await nextGrnNumber(user.businessId);
  const billNumber = await nextBillNumber(user.businessId);
  const dueDate = addDays(new Date(), po.supplier.paymentTermsDays || 30);

  const result = await prisma.$transaction(async (tx) => {
    const grn = await tx.goodsReceiptNote.create({
      data: {
        id: grnId,
        businessId: user.businessId,
        supplierId: po.supplierId,
        purchaseOrderId: po.id,
        warehouseId: warehouse.id,
        branchId,
        grnNumber,
        status: 'posted',
        receivedAt: body.received_at || body.receivedAt ? new Date(body.received_at || body.receivedAt) : new Date(),
        notes: body.notes || null,
        subtotal: toDec(subtotal),
        billId,
        createdById: user.id,
        items: {
          create: lines.map((l) => ({
            id: shortId('gri'),
            purchaseOrderItemId: l.purchaseOrderItemId,
            productId: l.productId,
            variantId: l.variantId,
            uomId: l.uomId,
            quantity: toDec(l.quantity),
            unitCost: toDec(l.unitCost),
            lineTotal: toDec(l.lineTotal),
            batchNumber: l.batchNumber,
            expiryDate: l.expiryDate,
            manufacturingDate: l.manufacturingDate
          }))
        }
      },
      include: { items: true }
    });

    for (const gri of grn.items) {
      const src = lines.find((l) => l.purchaseOrderItemId === gri.purchaseOrderItemId)!;
      const product = await tx.product.findFirst({ where: { id: gri.productId } });
      if (!product) throw httpError(400, 'Product missing for GRN line');

      const txnQty = Number(gri.quantity);
      const txnUomId = gri.uomId || product.baseUomId;
      const baseQty = await convertToBaseQty(
        tx,
        gri.productId,
        txnUomId,
        txnQty,
        product.baseUomId
      );
      const lineTotal = Number(gri.lineTotal);
      const unitCostPerBase =
        baseQty > 0 ? roundMoney(lineTotal / baseQty) : Number(gri.unitCost);

      const movement = await createStockMovement(
        user,
        {
          product_id: gri.productId,
          variant_id: gri.variantId,
          warehouse_id: warehouse.id,
          movement_type: 'receive',
          quantity_in: baseQty,
          unit_cost: unitCostPerBase,
          transaction_quantity: txnQty,
          transaction_uom_id: txnUomId,
          batch_number: gri.batchNumber,
          expiry_date: gri.expiryDate,
          manufacturing_date: gri.manufacturingDate,
          reference_type: 'grn',
          reference_id: grn.id,
          idempotency_key: `grn:${grn.id}:${gri.id}`,
          reason: `GRN ${grnNumber}`
        },
        tx
      );
      await tx.goodsReceiptItem.update({
        where: { id: gri.id },
        data: { stockMovementId: movement.id }
      });
      await tx.purchaseOrderItem.update({
        where: { id: src.purchaseOrderItemId },
        data: {
          quantityReceived: {
            increment: toDec(src.quantity)
          }
        }
      });
    }

    const refreshedItems = await tx.purchaseOrderItem.findMany({
      where: { purchaseOrderId: po.id }
    });
    const allReceived = refreshedItems.every(
      (it) => Number(it.quantityReceived) + 1e-9 >= Number(it.quantityOrdered)
    );
    const anyReceived = refreshedItems.some((it) => Number(it.quantityReceived) > 0);
    await tx.purchaseOrder.update({
      where: { id: po.id },
      data: {
        status: allReceived ? 'received' : anyReceived ? 'partially_received' : po.status
      }
    });

    const journal = await createJournal(
      user,
      {
        memo: `Purchase receipt ${grnNumber} / ${po.poNumber}`,
        source_type: 'grn',
        source_id: grn.id,
        idempotency_key: `grn:${grn.id}`,
        branch_id: branchId,
        supplier_id: po.supplierId,
        post: true,
        lines: [
          {
            account_id: accountMap.inventory,
            debit: subtotal,
            description: `Inventory from ${grnNumber}`
          },
          {
            account_id: accountMap.accounts_payable,
            credit: subtotal,
            description: `AP ${po.supplier.name} — ${grnNumber}`
          }
        ]
      },
      tx
    );

    const journalId = (journal as any).id as string;

    await tx.supplierBill.create({
      data: {
        id: billId,
        businessId: user.businessId,
        supplierId: po.supplierId,
        branchId,
        grnId: grn.id,
        billNumber,
        billDate: new Date(),
        dueDate,
        status: 'open',
        subtotal: toDec(subtotal),
        taxAmount: toDec(0),
        totalAmount: toDec(subtotal),
        amountPaid: toDec(0),
        balance: toDec(subtotal),
        journalEntryId: journalId,
        notes: `Auto bill from ${grnNumber}`
      }
    });

    // Absorb existing supplier prepaid into the new bill (memo only; cash already on AP).
    await consumePrepaidAgainstBillBalance(tx, user.businessId, po.supplierId, billId);

    await tx.goodsReceiptNote.update({
      where: { id: grn.id },
      data: { journalEntryId: journalId, billId }
    });

    return tx.goodsReceiptNote.findUnique({
      where: { id: grn.id },
      include: grnInclude
    });
  });

  await writeAudit({
    user,
    action: 'post',
    module: 'purchases',
    entityType: 'GoodsReceiptNote',
    entityId: grnId,
    summary: `Posted GRN ${grnNumber} for PO ${po.poNumber} (${subtotal})`
  });

  return serialize(result);
}

// ─── AP Bills & Payments ─────────────────────────────────────────────────────

export async function listSupplierBills(
  user: AuthUser,
  supplierId?: string,
  opts?: BranchListOpts
) {
  const scope = await branchAccess.branchScopeWhere(user, {
    branchId: opts?.branchId,
    allowConsolidated: opts?.allowConsolidated
  });
  const rows = await prisma.supplierBill.findMany({
    where: {
      businessId: user.businessId,
      ...scope,
      ...(supplierId ? { supplierId } : {})
    },
    include: {
      supplier: true,
      grn: true,
      branch: { select: { id: true, code: true, name: true } }
    },
    orderBy: { billDate: 'desc' }
  });
  return serialize(rows);
}

export async function listSupplierPayments(
  user: AuthUser,
  supplierId?: string,
  opts?: BranchListOpts
) {
  const scope = await branchAccess.branchScopeWhere(user, {
    branchId: opts?.branchId,
    allowConsolidated: opts?.allowConsolidated
  });
  const rows = await prisma.supplierPayment.findMany({
    where: {
      businessId: user.businessId,
      ...scope,
      ...(supplierId ? { supplierId } : {})
    },
    include: {
      supplier: true,
      account: true,
      allocations: { include: { bill: true } }
    },
    orderBy: { paymentDate: 'desc' }
  });
  return serialize(rows);
}

export async function getSupplierCredit(user: AuthUser, supplierId: string) {
  const supplier = await prisma.supplier.findFirst({
    where: { id: supplierId, businessId: user.businessId },
    select: { id: true }
  });
  if (!supplier) throw httpError(404, 'Supplier not found');
  const credit = await supplierPrepaidCredit(user.businessId, supplierId);
  return serialize(credit);
}

export async function recordSupplierPayment(user: AuthUser, body: Record<string, any>) {
  const supplierId = requireString(body.supplier_id || body.supplierId, 'supplier_id');
  const amount = roundMoney(Number(body.amount));
  if (!amount || amount <= 0) throw httpError(400, 'amount must be greater than 0');

  const branchId = await branchAccess.resolveWriteBranchId(
    user,
    body.branch_id || body.branchId || user.activeBranchId
  );

  const supplier = await prisma.supplier.findFirst({
    where: { id: supplierId, businessId: user.businessId }
  });
  if (!supplier) throw httpError(400, 'Invalid supplier_id');

  const accountMap = await getDefaultAccountMap(user.businessId);
  const method = String(body.method || 'bank').toLowerCase();
  let payAccountId = body.account_id || body.accountId || null;
  if (!payAccountId) {
    payAccountId = method === 'cash' ? accountMap.cash : accountMap.bank;
  }
  if (!payAccountId) throw httpError(400, 'Payment GL account (cash/bank) is not configured');

  const allowUnallocated =
    body.allow_unallocated !== false && body.allowUnallocated !== false;
  const mode = String(body.mode || body.intent || '')
    .toLowerCase()
    .trim();
  const allocationsInput: any[] = Array.isArray(body.allocations) ? body.allocations : [];
  let allocations: { billId: string; amount: number }[] = [];

  const parseAllocations = () => {
    const out: { billId: string; amount: number }[] = [];
    for (const [i, a] of allocationsInput.entries()) {
      const billId = a.bill_id || a.billId;
      const allocAmt = roundMoney(Number(a.amount));
      if (!billId || !allocAmt || allocAmt <= 0) {
        throw httpError(400, `allocations[${i}] requires bill_id and amount`);
      }
      out.push({ billId, amount: allocAmt });
    }
    return out;
  };

  if (allocationsInput.length) {
    allocations = parseAllocations();
  } else if (mode === 'advance' || body.leave_unallocated === true || body.leaveUnallocated === true) {
    allocations = [];
    if (!allowUnallocated) {
      throw httpError(400, 'Advance payments require allow_unallocated (supplier prepaid)');
    }
  } else {
    // Default / clear: FIFO across open AP bills; leftover stays as prepaid.
    allocations = await autoAllocateBills(user.businessId, supplierId, amount);
    if (!allocations.length && !allowUnallocated) {
      throw httpError(400, 'No open supplier bills to allocate this payment against');
    }
  }

  const { payment, replayed } = await prisma.$transaction(
    (tx) =>
      applySupplierPaymentInTx(tx, user, {
        supplierId,
        supplierName: supplier.name,
        payingBranchId: branchId,
        amount,
        method,
        accountId: payAccountId,
        allocations,
        allowUnallocated,
        reference: body.reference || null,
        notes: body.notes || null,
        paymentDate:
          body.payment_date || body.paymentDate
            ? new Date(body.payment_date || body.paymentDate)
            : undefined,
        idempotencyKey: body.idempotency_key || body.idempotencyKey || null
      }),
    { timeout: 30000, maxWait: 10000 }
  );

  if (!replayed) {
    await writeAudit({
      user,
      action: 'post',
      module: 'purchases',
      entityType: 'SupplierPayment',
      entityId: payment.id,
      summary: `Recorded supplier payment ${payment.paymentNumber} (${amount})`
    });
  }

  return serialize(payment);
}
