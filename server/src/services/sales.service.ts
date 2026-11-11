import { prisma } from '../utils/prisma.js';
import {
  httpError,
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

type BranchListOpts = {
  branchId?: string | null;
  allowConsolidated?: boolean;
};

const invoiceInclude = {
  customer: true,
  warehouse: true,
  salesRep: true,
  items: {
    include: { product: true, variant: true, uom: true },
    orderBy: { id: 'asc' as const }
  },
  commissions: true
};

async function nextInvoiceNumber(businessId: string, channel: string) {
  const count = await prisma.salesInvoice.count({ where: { businessId } });
  const prefix = channel === 'pos' ? 'POS' : 'INV';
  return `${prefix}-${String(count + 1).padStart(5, '0')}`;
}

async function nextPaymentNumber(businessId: string) {
  const count = await prisma.customerPayment.count({ where: { businessId } });
  return `CPAY-${String(count + 1).padStart(5, '0')}`;
}

function addDays(date: Date, days: number) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

async function productAllowedUomIds(productId: string, baseUomId: string, sellingUomId?: string | null) {
  const conversions = await prisma.productUnitConversion.findMany({ where: { productId } });
  const ids = new Set<string>([baseUomId]);
  if (sellingUomId) ids.add(sellingUomId);
  for (const c of conversions) {
    ids.add(c.fromUomId);
    ids.add(c.toUomId);
  }
  return ids;
}

function resolveUnitPrice(product: any, bodyItem: any, uomId: string) {
  if (bodyItem.unit_price != null || bodyItem.unitPrice != null) {
    return Number(bodyItem.unit_price ?? bodyItem.unitPrice);
  }
  const level = String(bodyItem.price_level || bodyItem.priceLevel || 'retail').toLowerCase();
  const prices: any[] = product.sellingPrices || [];
  const match =
    prices.find((p) => p.uomId === uomId && p.priceLevel === level && p.isActive) ||
    prices.find((p) => p.uomId === uomId && p.isDefault && p.isActive) ||
    prices.find((p) => p.uomId === uomId && p.isActive);
  if (match) return Number(match.unitPrice);
  if (level === 'wholesale' && product.wholesalePrice != null) return Number(product.wholesalePrice);
  if (level === 'distributor' && product.distributorPrice != null) {
    return Number(product.distributorPrice);
  }
  return Number(product.defaultSellingPrice || product.retailPrice || 0);
}

async function buildInvoiceLines(user: AuthUser, itemsInput: any[]) {
  if (!itemsInput.length) throw httpError(400, 'At least one line item is required');
  const lines: {
    productId: string;
    variantId: string | null;
    uomId: string;
    quantity: number;
    unitPrice: number;
    lineTotal: number;
    priceLevel: string | null;
  }[] = [];

  for (const [i, item] of itemsInput.entries()) {
    const productId = item.product_id || item.productId;
    if (!productId) throw httpError(400, `items[${i}].product_id is required`);
    const product = await prisma.product.findFirst({
      where: { id: productId, businessId: user.businessId },
      include: { variants: true, sellingPrices: true, conversions: true }
    });
    if (!product) throw httpError(400, `items[${i}] product not found`);

    let variantId = item.variant_id || item.variantId || null;
    if (!variantId) {
      const def = product.variants.find((v) => v.isDefault) || product.variants[0];
      variantId = def?.id || null;
    }

    const allowed = await productAllowedUomIds(
      product.id,
      product.baseUomId,
      product.sellingUomId
    );
    const uomId =
      item.uom_id || item.uomId || product.sellingUomId || product.baseUomId;
    if (!uomId || !allowed.has(uomId)) {
      throw httpError(
        400,
        `items[${i}].uom_id must be the product base, selling, or packaging UoM`
      );
    }

    const qty = Number(item.quantity);
    if (!qty || qty <= 0) throw httpError(400, `items[${i}].quantity must be > 0`);
    const unitPrice = resolveUnitPrice(product, item, uomId);
    if (unitPrice < 0) throw httpError(400, `items[${i}].unit_price cannot be negative`);

    lines.push({
      productId,
      variantId,
      uomId,
      quantity: qty,
      unitPrice,
      lineTotal: roundMoney(qty * unitPrice),
      priceLevel: item.price_level || item.priceLevel || 'retail'
    });
  }
  return lines;
}

export async function listInvoices(
  user: AuthUser,
  opts?: { status?: string; channel?: string } & BranchListOpts
) {
  const scope = await branchAccess.branchScopeWhere(user, {
    branchId: opts?.branchId,
    allowConsolidated: opts?.allowConsolidated
  });
  const rows = await prisma.salesInvoice.findMany({
    where: {
      businessId: user.businessId,
      ...scope,
      ...(opts?.status ? { status: opts.status } : {}),
      ...(opts?.channel ? { channel: opts.channel } : {})
    },
    include: invoiceInclude,
    orderBy: { createdAt: 'desc' }
  });
  return serialize(rows);
}

export async function getInvoice(businessId: string, id: string) {
  const row = await prisma.salesInvoice.findFirst({
    where: { id, businessId },
    include: {
      ...invoiceInclude,
      allocations: { include: { payment: true } }
    }
  });
  if (!row) throw httpError(404, 'Invoice not found');
  return serialize(row);
}

export async function createInvoice(user: AuthUser, body: Record<string, any>) {
  const customerId = requireString(body.customer_id || body.customerId, 'customer_id');
  const warehouseId = requireString(body.warehouse_id || body.warehouseId, 'warehouse_id');
  const channel = String(body.channel || 'sales').toLowerCase() === 'pos' ? 'pos' : 'sales';
  const itemsInput: any[] = Array.isArray(body.items) ? body.items : [];

  const customer = await prisma.customer.findFirst({
    where: { id: customerId, businessId: user.businessId, status: 'active' }
  });
  if (!customer) throw httpError(400, 'Invalid customer_id');

  const branchId = await branchAccess.resolveWriteBranchId(
    user,
    body.branch_id || body.branchId || user.activeBranchId
  );
  const warehouse = await branchAccess.resolveWarehouseInBranch(
    user.businessId,
    warehouseId,
    branchId
  );

  const salesRepId = body.sales_rep_id || body.salesRepId || null;
  if (salesRepId) {
    const rep = await prisma.salesRep.findFirst({
      where: { id: salesRepId, businessId: user.businessId, status: 'active' }
    });
    if (!rep) throw httpError(400, 'Invalid sales_rep_id');
  }

  const lines = await buildInvoiceLines(user, itemsInput);
  const subtotal = roundMoney(lines.reduce((s, l) => s + l.lineTotal, 0));
  const taxAmount = roundMoney(Number(body.tax_amount ?? body.taxAmount ?? 0));
  const totalAmount = roundMoney(subtotal + taxAmount);
  const invoiceNumber =
    body.invoice_number || body.invoiceNumber || (await nextInvoiceNumber(user.businessId, channel));

  const created = await prisma.salesInvoice.create({
    data: {
      id: shortId('inv'),
      businessId: user.businessId,
      customerId,
      warehouseId: warehouse.id,
      branchId,
      salesRepId,
      invoiceNumber,
      channel,
      status: 'draft',
      paymentStatus: 'open',
      invoiceDate: body.invoice_date || body.invoiceDate
        ? new Date(body.invoice_date || body.invoiceDate)
        : new Date(),
      dueDate:
        body.due_date || body.dueDate
          ? new Date(body.due_date || body.dueDate)
          : customer.paymentTermsDays
            ? addDays(new Date(), customer.paymentTermsDays)
            : null,
      notes: body.notes || null,
      subtotal: toDec(subtotal),
      taxAmount: toDec(taxAmount),
      totalAmount: toDec(totalAmount),
      amountPaid: toDec(0),
      balance: toDec(totalAmount),
      createdById: user.id,
      items: {
        create: lines.map((l) => ({
          id: shortId('sii'),
          productId: l.productId,
          variantId: l.variantId,
          uomId: l.uomId,
          quantity: toDec(l.quantity),
          unitPrice: toDec(l.unitPrice),
          lineTotal: toDec(l.lineTotal),
          priceLevel: l.priceLevel
        }))
      }
    },
    include: invoiceInclude
  });

  await writeAudit({
    user,
    action: 'create',
    module: channel === 'pos' ? 'pos' : 'sales',
    entityType: 'SalesInvoice',
    entityId: created.id,
    summary: `Created ${channel} invoice ${created.invoiceNumber}`
  });

  const autoPost = body.post === true || body.pay_now === true || body.payNow === true || channel === 'pos';
  if (autoPost) {
    return postInvoice(user, created.id, {
      pay_now: body.pay_now ?? body.payNow ?? channel === 'pos',
      payment_method: body.payment_method || body.paymentMethod || (channel === 'pos' ? 'cash' : undefined),
      account_id: body.account_id || body.accountId
    });
  }

  return serialize(created);
}

/**
 * Post invoice: FEFO stock issue + revenue journal + COGS journal + optional commission.
 * pay_now / POS: settle cash|bank immediately (no open AR).
 */
export async function postInvoice(
  user: AuthUser,
  id: string,
  opts?: {
    pay_now?: boolean;
    payment_method?: string;
    account_id?: string;
  }
) {
  const invoice = await prisma.salesInvoice.findFirst({
    where: { id, businessId: user.businessId },
    include: { items: true, customer: true, salesRep: true, warehouse: true }
  });
  if (!invoice) throw httpError(404, 'Invoice not found');
  if (invoice.status !== 'draft') throw httpError(400, 'Only draft invoices can be posted');
  if (!invoice.items.length) throw httpError(400, 'Invoice has no lines');

  const accountMap = await getDefaultAccountMap(user.businessId);
  for (const key of ['sales_revenue', 'cogs', 'inventory', 'accounts_receivable', 'cash', 'bank']) {
    if (!accountMap[key]) throw httpError(400, `Default account "${key}" is not configured`);
  }

  const payNow = Boolean(opts?.pay_now) || invoice.channel === 'pos';
  const method = String(opts?.payment_method || (payNow ? 'cash' : '')).toLowerCase();
  let settleAccountId = opts?.account_id || null;
  if (payNow) {
    settleAccountId =
      settleAccountId || (method === 'bank' || method === 'transfer' ? accountMap.bank : accountMap.cash);
  }

  const totalAmount = Number(invoice.totalAmount);

  const result = await prisma.$transaction(async (tx) => {
    let totalCogs = 0;

    for (const line of invoice.items) {
      const product = await tx.product.findFirst({ where: { id: line.productId } });
      if (!product) throw httpError(400, 'Product missing on invoice line');

      const txnQty = Number(line.quantity);
      const txnUomId = line.uomId || product.baseUomId;
      const baseQty = await convertToBaseQty(
        tx,
        line.productId,
        txnUomId,
        txnQty,
        product.baseUomId
      );

      await createStockMovement(
        user,
        {
          product_id: line.productId,
          variant_id: line.variantId,
          warehouse_id: invoice.warehouseId,
          movement_type: 'sale',
          quantity_out: baseQty,
          transaction_quantity: txnQty,
          transaction_uom_id: txnUomId,
          reference_type: 'sales_invoice',
          reference_id: invoice.id,
          idempotency_key: `sale:${invoice.id}:${line.id}`,
          reason: `Sale ${invoice.invoiceNumber}`
        },
        tx
      );

      const movements = await tx.stockMovement.findMany({
        where: {
          businessId: user.businessId,
          referenceType: 'sales_invoice',
          referenceId: invoice.id,
          productId: line.productId,
          idempotencyKey: { startsWith: `sale:${invoice.id}:${line.id}` }
        }
      });
      // Also catch single-key movement
      const movAlt = await tx.stockMovement.findMany({
        where: {
          businessId: user.businessId,
          referenceType: 'sales_invoice',
          referenceId: invoice.id,
          productId: line.productId
        }
      });
      const related = [...movements, ...movAlt].filter(
        (m, idx, arr) =>
          (m.idempotencyKey || '').startsWith(`sale:${invoice.id}:${line.id}`) &&
          arr.findIndex((x) => x.id === m.id) === idx
      );
      const lineCogs = roundMoney(
        related.reduce((s, m) => s + Number(m.totalCost || 0), 0)
      );
      totalCogs = roundMoney(totalCogs + lineCogs);

      await tx.salesInvoiceItem.update({
        where: { id: line.id },
        data: {
          cogsAmount: toDec(lineCogs),
          stockMovementId: related[0]?.id || null
        }
      });
    }

    const revenueJournal = await createJournal(
      user,
      {
        memo: `Sales ${invoice.invoiceNumber} — ${invoice.customer.name}`,
        source_type: 'sales_invoice',
        source_id: invoice.id,
        idempotency_key: `sales_invoice:${invoice.id}`,
        branch_id: invoice.branchId || undefined,
        post: true,
        lines: [
          {
            account_id: payNow ? settleAccountId! : accountMap.accounts_receivable,
            debit: totalAmount,
            description: payNow
              ? `${method || 'cash'} sale ${invoice.invoiceNumber}`
              : `AR ${invoice.customer.name} — ${invoice.invoiceNumber}`
          },
          {
            account_id: accountMap.sales_revenue,
            credit: totalAmount,
            description: `Revenue ${invoice.invoiceNumber}`
          }
        ]
      },
      tx
    );

    let cogsJournalId: string | null = null;
    if (totalCogs > 0) {
      const cogsJournal = await createJournal(
        user,
        {
          memo: `COGS ${invoice.invoiceNumber}`,
          source_type: 'sales_cogs',
          source_id: invoice.id,
          idempotency_key: `sales_cogs:${invoice.id}`,
          branch_id: invoice.branchId || undefined,
          post: true,
          lines: [
            {
              account_id: accountMap.cogs,
              debit: totalCogs,
              description: `COGS ${invoice.invoiceNumber}`
            },
            {
              account_id: accountMap.inventory,
              credit: totalCogs,
              description: `Inventory relief ${invoice.invoiceNumber}`
            }
          ]
        },
        tx
      );
      cogsJournalId = (cogsJournal as any).id;
    }

    if (invoice.salesRepId && invoice.salesRep) {
      const pct = Number(invoice.salesRep.commissionPercent || 0);
      if (pct > 0) {
        const commissionAmount = roundMoney((totalAmount * pct) / 100);
        await tx.salesCommission.create({
          data: {
            id: shortId('scm'),
            businessId: user.businessId,
            branchId: invoice.branchId,
            salesRepId: invoice.salesRepId,
            invoiceId: invoice.id,
            baseAmount: toDec(totalAmount),
            commissionPercent: toDec(pct),
            commissionAmount: toDec(commissionAmount),
            status: 'accrued'
          }
        });
      }
    }

    let paymentId: string | null = null;
    if (payNow) {
      paymentId = shortId('cpay');
      const payCount = await tx.customerPayment.count({ where: { businessId: user.businessId } });
      const paymentNumber = `CPAY-${String(payCount + 1).padStart(5, '0')}`;
      // Cash already booked in revenue journal — record payment allocation without second cash journal
      await tx.customerPayment.create({
        data: {
          id: paymentId,
          businessId: user.businessId,
          branchId: invoice.branchId,
          customerId: invoice.customerId,
          paymentNumber,
          paymentDate: new Date(),
          amount: toDec(totalAmount),
          method: method || 'cash',
          accountId: settleAccountId,
          reference: invoice.invoiceNumber,
          notes: `Immediate settlement for ${invoice.invoiceNumber}`,
          journalEntryId: (revenueJournal as any).id,
          createdById: user.id,
          allocations: {
            create: [
              {
                id: shortId('cpa'),
                invoiceId: invoice.id,
                amount: toDec(totalAmount)
              }
            ]
          }
        }
      });
    }

    return tx.salesInvoice.update({
      where: { id: invoice.id },
      data: {
        status: 'posted',
        paymentStatus: payNow ? 'paid' : 'open',
        amountPaid: toDec(payNow ? totalAmount : 0),
        balance: toDec(payNow ? 0 : totalAmount),
        journalEntryId: (revenueJournal as any).id,
        cogsJournalEntryId: cogsJournalId,
        postedAt: new Date(),
        postedById: user.id
      },
      include: invoiceInclude
    });
  });

  await writeAudit({
    user,
    action: 'post',
    module: invoice.channel === 'pos' ? 'pos' : 'sales',
    entityType: 'SalesInvoice',
    entityId: id,
    summary: `Posted ${invoice.invoiceNumber}${payNow ? ' (paid)' : ''}`
  });

  return serialize(result);
}

export async function listCustomerPayments(
  user: AuthUser,
  customerId?: string,
  opts?: BranchListOpts
) {
  const scope = await branchAccess.branchScopeWhere(user, {
    branchId: opts?.branchId,
    allowConsolidated: opts?.allowConsolidated
  });
  const rows = await prisma.customerPayment.findMany({
    where: {
      businessId: user.businessId,
      ...scope,
      ...(customerId ? { customerId } : {})
    },
    include: {
      customer: true,
      account: true,
      allocations: { include: { invoice: true } }
    },
    orderBy: { paymentDate: 'desc' }
  });
  return serialize(rows);
}

export async function recordCustomerPayment(user: AuthUser, body: Record<string, any>) {
  const customerId = requireString(body.customer_id || body.customerId, 'customer_id');
  const amount = roundMoney(Number(body.amount));
  if (!amount || amount <= 0) throw httpError(400, 'amount must be greater than 0');

  const branchId = await branchAccess.resolveWriteBranchId(
    user,
    body.branch_id || body.branchId || user.activeBranchId
  );

  const customer = await prisma.customer.findFirst({
    where: { id: customerId, businessId: user.businessId }
  });
  if (!customer) throw httpError(400, 'Invalid customer_id');

  const accountMap = await getDefaultAccountMap(user.businessId);
  if (!accountMap.accounts_receivable) {
    throw httpError(400, 'Default accounts_receivable account must be configured');
  }

  const method = String(body.method || 'cash').toLowerCase();
  let payAccountId = body.account_id || body.accountId || null;
  if (!payAccountId) {
    payAccountId = method === 'bank' || method === 'transfer' ? accountMap.bank : accountMap.cash;
  }
  if (!payAccountId) throw httpError(400, 'Payment GL account (cash/bank) is not configured');

  const allocationsInput: any[] = Array.isArray(body.allocations) ? body.allocations : [];
  let remaining = amount;
  const allocations: { invoiceId: string; amount: number }[] = [];

  if (allocationsInput.length) {
    for (const [i, a] of allocationsInput.entries()) {
      const invoiceId = a.invoice_id || a.invoiceId;
      const allocAmt = roundMoney(Number(a.amount));
      if (!invoiceId || !allocAmt || allocAmt <= 0) {
        throw httpError(400, `allocations[${i}] requires invoice_id and amount`);
      }
      allocations.push({ invoiceId, amount: allocAmt });
      remaining = roundMoney(remaining - allocAmt);
    }
    if (remaining < -0.01) throw httpError(400, 'Allocations exceed payment amount');
  } else {
    const openInvoices = await prisma.salesInvoice.findMany({
      where: {
        businessId: user.businessId,
        branchId,
        customerId,
        status: 'posted',
        paymentStatus: { in: ['open', 'partial'] },
        balance: { gt: 0 }
      },
      orderBy: { invoiceDate: 'asc' }
    });
    for (const inv of openInvoices) {
      if (remaining <= 0) break;
      const bal = Number(inv.balance);
      const apply = roundMoney(Math.min(bal, remaining));
      if (apply <= 0) continue;
      allocations.push({ invoiceId: inv.id, amount: apply });
      remaining = roundMoney(remaining - apply);
    }
  }

  const allocatedTotal = roundMoney(allocations.reduce((s, a) => s + a.amount, 0));
  if (allocatedTotal <= 0) {
    throw httpError(400, 'No open customer invoices to allocate this payment against');
  }
  if (
    Math.abs(allocatedTotal - amount) > 0.01 &&
    body.allow_unallocated !== true &&
    body.allowUnallocated !== true
  ) {
    throw httpError(
      400,
      `Payment amount ${amount} does not match allocated ${allocatedTotal}`
    );
  }

  const paymentId = shortId('cpay');
  const paymentNumber = await nextPaymentNumber(user.businessId);

  const result = await prisma.$transaction(async (tx) => {
    for (const a of allocations) {
      const inv = await tx.salesInvoice.findFirst({
        where: {
          id: a.invoiceId,
          businessId: user.businessId,
          customerId,
          status: 'posted',
          branchId
        }
      });
      if (!inv) throw httpError(400, `Invoice ${a.invoiceId} not found for customer`);
      const bal = Number(inv.balance);
      if (a.amount > bal + 0.01) {
        throw httpError(400, `Allocation exceeds balance on ${inv.invoiceNumber}`);
      }
      const newPaid = roundMoney(Number(inv.amountPaid) + a.amount);
      const newBal = roundMoney(Number(inv.totalAmount) - newPaid);
      await tx.salesInvoice.update({
        where: { id: inv.id },
        data: {
          amountPaid: toDec(newPaid),
          balance: toDec(Math.max(0, newBal)),
          paymentStatus: newBal <= 0.01 ? 'paid' : 'partial'
        }
      });
    }

    const journal = await createJournal(
      user,
      {
        memo: `Customer payment ${paymentNumber} — ${customer.name}`,
        source_type: 'customer_payment',
        source_id: paymentId,
        idempotency_key: `customer_payment:${paymentId}`,
        branch_id: branchId,
        post: true,
        lines: [
          {
            account_id: payAccountId!,
            debit: allocatedTotal,
            description: `${method} receipt ${paymentNumber}`
          },
          {
            account_id: accountMap.accounts_receivable,
            credit: allocatedTotal,
            description: `AR settlement ${paymentNumber}`
          }
        ]
      },
      tx
    );

    return tx.customerPayment.create({
      data: {
        id: paymentId,
        businessId: user.businessId,
        branchId,
        customerId,
        paymentNumber,
        paymentDate: body.payment_date || body.paymentDate
          ? new Date(body.payment_date || body.paymentDate)
          : new Date(),
        amount: toDec(allocatedTotal),
        method,
        accountId: payAccountId,
        reference: body.reference || null,
        notes: body.notes || null,
        journalEntryId: (journal as any).id,
        createdById: user.id,
        allocations: {
          create: allocations.map((a) => ({
            id: shortId('cpa'),
            invoiceId: a.invoiceId,
            amount: toDec(a.amount)
          }))
        }
      },
      include: {
        customer: true,
        account: true,
        allocations: { include: { invoice: true } }
      }
    });
  });

  await writeAudit({
    user,
    action: 'post',
    module: 'sales',
    entityType: 'CustomerPayment',
    entityId: paymentId,
    summary: `Recorded customer payment ${paymentNumber} (${allocatedTotal})`
  });

  return serialize(result);
}
