import { Prisma } from '@prisma/client';
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
import { createJournal, getDefaultAccountMap } from './accounting.service.js';
import { convertToBaseQty, createStockMovement } from './inventory.service.js';
import * as branchAccess from './branch-access.service.js';
import { lockInvoices, paymentStatusFor } from './customer-payment.service.js';
import { lineValue } from './fulfilment.service.js';
import { roundQty } from './stock-allocation.service.js';

type Tx = Prisma.TransactionClient;
const n = (v: unknown) => Number(v || 0);
const EPS = 1e-6;
const TX = { timeout: 30000, maxWait: 10000 } as const;

const CONDITIONS = new Set(['saleable', 'damaged', 'quarantine']);
const SETTLEMENTS = new Set(['credit_note', 'refund']);

function returnInclude() {
  return {
    items: {
      include: {
        invoiceItem: {
          include: { product: { select: { id: true, name: true, sku: true } } }
        }
      }
    },
    invoice: { select: { id: true, invoiceNumber: true, recognitionPolicy: true } },
    customer: { select: { id: true, name: true, code: true } },
    warehouse: { select: { id: true, name: true, code: true, category: true } },
    branch: { select: { id: true, name: true, code: true } },
    revenueBranch: { select: { id: true, name: true, code: true } },
    fulfilment: { select: { id: true, fulfilmentNumber: true } }
  } as const;
}

async function loadReturn(tx: Tx | typeof prisma, businessId: string, id: string) {
  const row = await tx.salesReturn.findFirst({
    where: { id, businessId },
    include: returnInclude()
  });
  if (!row) throw httpError(404, 'Sales return not found');
  return row;
}

/** Qty still eligible to return on a line (handed over minus already returned). */
export function returnableQty(item: { fulfilledQuantity: unknown; returnedQuantity: unknown }) {
  return roundQty(Math.max(0, n(item.fulfilledQuantity) - n(item.returnedQuantity)));
}

/**
 * Create a draft return against a posted invoice for goods already handed over.
 * Receiving warehouse may be any authorised branch warehouse (including another branch).
 */
export async function createReturn(user: AuthUser, body: Record<string, any>) {
  const invoiceId = requireString(body.invoice_id || body.invoiceId, 'invoice_id');
  const warehouseId = requireString(body.warehouse_id || body.warehouseId, 'warehouse_id');
  const reason = String(body.reason || '').trim() || null;
  const condition = String(body.condition || 'saleable').toLowerCase();
  if (!CONDITIONS.has(condition)) throw httpError(400, 'condition must be saleable, damaged or quarantine');
  const settlement = String(body.settlement || 'credit_note').toLowerCase();
  if (!SETTLEMENTS.has(settlement)) throw httpError(400, 'settlement must be credit_note or refund');
  const fulfilmentId = (body.fulfilment_id || body.fulfilmentId || null) as string | null;
  const linesIn = Array.isArray(body.items) ? body.items : [];
  if (!linesIn.length) throw httpError(400, 'items are required');

  const warehouse = await prisma.warehouse.findFirst({
    where: { id: warehouseId, businessId: user.businessId, isActive: true },
    include: { branch: true }
  });
  if (!warehouse) throw httpError(404, 'Warehouse not found');
  await branchAccess.assertBranchMembership(user, warehouse.branchId);
  await branchAccess.assertBranchActive(user.businessId, warehouse.branchId);

  if (condition === 'damaged' && warehouse.category !== 'damaged' && body.restock !== false) {
    // Restocking damaged goods into a sellable warehouse is refused; allow write-off (restock false)
    // or require a damaged warehouse.
  }

  const created = await prisma.$transaction(async (tx) => {
    const invoice = await tx.salesInvoice.findFirst({
      where: { id: invoiceId, businessId: user.businessId },
      include: { items: true, customer: true }
    });
    if (!invoice) throw httpError(404, 'Invoice not found');
    if (invoice.status !== 'posted' && invoice.status !== 'cancelled') {
      throw httpError(400, 'Only confirmed (or closed) invoices can accept returns');
    }
    const handed = invoice.items.some((i) => n(i.fulfilledQuantity) > EPS);
    if (!handed) throw httpError(400, 'Nothing has been handed over on this invoice yet');

    if (fulfilmentId) {
      const ful = await tx.salesFulfilment.findFirst({
        where: { id: fulfilmentId, businessId: user.businessId, invoiceId },
        select: { id: true, status: true }
      });
      if (!ful) throw httpError(404, 'Fulfilment not found on this invoice');
      if (!['released', 'delivered'].includes(ful.status)) {
        throw httpError(400, 'Returns must reference a released or delivered fulfilment');
      }
    }

    const revenueBranchId = invoice.branchId || warehouse.branchId;
    const itemsData: {
      id: string;
      invoiceItemId: string;
      productId: string;
      variantId: string | null;
      uomId: string | null;
      quantity: Prisma.Decimal;
      baseQuantity: Prisma.Decimal;
      unitPrice: Prisma.Decimal;
      lineTotal: Prisma.Decimal;
      condition: string;
      restock: boolean;
      notes: string | null;
    }[] = [];
    let subtotal = 0;

    for (const raw of linesIn) {
      const invoiceItemId = requireString(raw.invoice_item_id || raw.invoiceItemId, 'invoice_item_id');
      const qty = roundQty(Number(raw.quantity));
      if (!(qty > 0)) throw httpError(400, 'Return quantity must be greater than 0');
      const line = invoice.items.find((i) => i.id === invoiceItemId);
      if (!line) throw httpError(400, `Line ${invoiceItemId} is not on this invoice`);
      const left = returnableQty(line);
      if (qty > left + EPS) {
        throw httpError(
          400,
          `${line.productId}: only ${left} of ${n(line.fulfilledQuantity)} handed over can still be returned`
        );
      }
      const lineCond = String(raw.condition || condition).toLowerCase();
      if (!CONDITIONS.has(lineCond)) throw httpError(400, 'item condition is invalid');
      const restock =
        raw.restock != null
          ? Boolean(raw.restock)
          : lineCond === 'saleable'
            ? true
            : lineCond === 'quarantine'
              ? true
              : false;
      if (restock && lineCond === 'damaged' && warehouse.category !== 'damaged') {
        throw httpError(
          400,
          'Damaged goods that will be restocked must be received into a warehouse marked damaged'
        );
      }
      if (restock && lineCond === 'quarantine' && warehouse.category !== 'quarantine') {
        throw httpError(
          400,
          'Quarantine returns that will be restocked must be received into a quarantine warehouse'
        );
      }
      const product = await tx.product.findFirst({
        where: { id: line.productId, businessId: user.businessId },
        select: { id: true, baseUomId: true, name: true }
      });
      if (!product) throw httpError(404, 'Product not found');
      const baseQty = roundQty(
        await convertToBaseQty(tx, line.productId, line.uomId, qty, product.baseUomId)
      );
      const share = n(line.quantity) > 0 ? qty / n(line.quantity) : 0;
      const lineTotal = roundMoney(n(line.lineTotal) * share);
      subtotal = roundMoney(subtotal + lineTotal);
      itemsData.push({
        id: shortId('sri'),
        invoiceItemId: line.id,
        productId: line.productId,
        variantId: line.variantId,
        uomId: line.uomId,
        quantity: toDec(qty),
        baseQuantity: toDec(baseQty),
        unitPrice: toDec(n(line.unitPrice)),
        lineTotal: toDec(lineTotal),
        condition: lineCond,
        restock,
        notes: raw.notes ? String(raw.notes) : null
      });
      // Temporarily bump returned on the in-memory line so two lines of the same request cannot over-return
      (line as any).returnedQuantity = toDec(n(line.returnedQuantity) + qty);
    }

    const taxShare =
      n(invoice.subtotal) > 0
        ? roundMoney((subtotal * n(invoice.taxAmount)) / n(invoice.subtotal))
        : 0;
    // Customer discount already baked into lineTotal via invoice totals — use value share for recognition
    let recognised = 0;
    for (const it of itemsData) {
      const invLine = invoice.items.find((i) => i.id === it.invoiceItemId)!;
      const value = lineValue(invoice, invLine);
      const share = n(invLine.quantity) > 0 ? n(it.quantity) / n(invLine.quantity) : 0;
      recognised = roundMoney(recognised + value * share);
    }
    recognised = roundMoney(recognised);
    const total = recognised; // already includes tax share via lineValue
    const taxAmount =
      n(invoice.totalAmount) > 0
        ? roundMoney((recognised * n(invoice.taxAmount)) / n(invoice.totalAmount))
        : taxShare;

    const returnNumber = await nextDocNumber(tx.salesReturn, user.businessId, 'returnNumber', 'RET', 5);
    const id = shortId('ret');
    await tx.salesReturn.create({
      data: {
        id,
        businessId: user.businessId,
        returnNumber,
        invoiceId: invoice.id,
        fulfilmentId,
        customerId: invoice.customerId,
        branchId: warehouse.branchId,
        warehouseId: warehouse.id,
        revenueBranchId,
        status: 'draft',
        reason,
        condition,
        settlement,
        refundMethod: settlement === 'refund' ? String(body.refund_method || body.method || 'cash') : null,
        refundAccountId: settlement === 'refund' ? (body.refund_account_id || body.account_id || null) : null,
        subtotal: toDec(subtotal),
        taxAmount: toDec(taxAmount),
        totalAmount: toDec(total),
        notes: body.notes ? String(body.notes) : null,
        createdById: user.id,
        items: { create: itemsData }
      }
    });
    return id;
  }, TX);

  await writeAudit({
    user,
    module: 'sales',
    action: 'return_create',
    entityType: 'SalesReturn',
    entityId: created,
    summary: `Draft sales return for invoice ${invoiceId}`,
    metadata: { warehouse_id: warehouseId, invoice_id: invoiceId }
  });

  return serialize(await loadReturn(prisma, user.businessId, created));
}

export async function listReturns(
  user: AuthUser,
  filter: { invoiceId?: string; customerId?: string; status?: string; q?: string } = {}
) {
  const scope = await branchAccess.branchScopeWhere(user, { allowConsolidated: true });
  const rows = await prisma.salesReturn.findMany({
    where: {
      businessId: user.businessId,
      branchId: scope.branchId as any,
      ...(filter.invoiceId ? { invoiceId: filter.invoiceId } : {}),
      ...(filter.customerId ? { customerId: filter.customerId } : {}),
      ...(filter.status ? { status: filter.status } : {}),
      ...(filter.q
        ? {
            OR: [
              { returnNumber: { contains: filter.q } },
              { invoice: { invoiceNumber: { contains: filter.q } } },
              { customer: { name: { contains: filter.q } } }
            ]
          }
        : {})
    },
    include: {
      customer: { select: { id: true, name: true, code: true } },
      invoice: { select: { id: true, invoiceNumber: true } },
      warehouse: { select: { id: true, name: true, code: true } },
      branch: { select: { id: true, name: true, code: true } }
    },
    orderBy: { createdAt: 'desc' },
    take: 200
  });
  return serialize(rows);
}

export async function getReturn(user: AuthUser, id: string) {
  const row = await loadReturn(prisma, user.businessId, id);
  await branchAccess.assertBranchMembership(user, row.branchId);
  return serialize(row);
}

export async function voidReturn(user: AuthUser, id: string, body: Record<string, any> = {}) {
  const reason = requireString(body.reason, 'reason');
  const row = await prisma.salesReturn.findFirst({ where: { id, businessId: user.businessId } });
  if (!row) throw httpError(404, 'Sales return not found');
  if (row.status !== 'draft') throw httpError(400, 'Only draft returns can be voided');
  await branchAccess.assertBranchMembership(user, row.branchId);
  await prisma.salesReturn.update({
    where: { id },
    data: { status: 'void', reason: row.reason || reason, notes: [row.notes, `Voided: ${reason}`].filter(Boolean).join('\n') }
  });
  return serialize(await loadReturn(prisma, user.businessId, id));
}

/**
 * Post a draft return: restore stock (when restock), reverse revenue/tax/COGS, settle credit or refund.
 */
export async function postReturn(user: AuthUser, id: string, body: Record<string, any> = {}) {
  const postedId = await prisma.$transaction(async (tx) => {
    const ret = await tx.salesReturn.findFirst({
      where: { id, businessId: user.businessId },
      include: {
        items: true,
        warehouse: true,
        invoice: { include: { items: true, customer: true } }
      }
    });
    if (!ret) throw httpError(404, 'Sales return not found');
    if (ret.status !== 'draft') throw httpError(400, 'Return is not a draft');
    await branchAccess.assertBranchMembership(user, ret.branchId);
    await branchAccess.assertBranchActive(user.businessId, ret.branchId);

    const reason = String(body.reason || ret.reason || '').trim();
    if (!reason) throw httpError(400, 'reason is required to post a return');

    let settlement = String(body.settlement || ret.settlement || 'credit_note').toLowerCase();
    if (!SETTLEMENTS.has(settlement)) throw httpError(400, 'settlement must be credit_note or refund');
    const refundAccountId =
      (body.refund_account_id || body.account_id || ret.refundAccountId || null) as string | null;
    const refundMethod = String(body.refund_method || body.method || ret.refundMethod || 'cash');
    if (settlement === 'refund' && !refundAccountId) {
      throw httpError(400, 'refund_account_id is required for a cash/bank refund');
    }

    await lockInvoices(tx, [ret.invoiceId]);
    const invoice = await tx.salesInvoice.findUniqueOrThrow({
      where: { id: ret.invoiceId },
      include: { items: true }
    });

    // Re-validate returnable qty under the lock
    for (const it of ret.items) {
      const line = invoice.items.find((i) => i.id === it.invoiceItemId);
      if (!line) throw httpError(400, 'Invoice line missing');
      if (n(it.quantity) > returnableQty(line) + EPS) {
        throw httpError(400, 'Return quantity exceeds what is still returnable (another return may have posted)');
      }
    }

    const accountMap = await getDefaultAccountMap(user.businessId);
    for (const key of ['sales_returns', 'accounts_receivable', 'cogs', 'inventory']) {
      if (!accountMap[key]) throw httpError(400, `Default account "${key}" is not configured`);
    }
    const hasTax = n(ret.taxAmount) > 0.009;
    if (hasTax && !accountMap.tax_payable) {
      throw httpError(400, 'Default account "tax_payable" is not configured');
    }

    // Cost basis: prefer the referenced fulfilment's unit cost; else average from all released items
    const costByLine = await averageCostByLine(tx, invoice.id, ret.fulfilmentId);

    let cogsTotal = 0;
    let inventoryRestored = 0;
    let writeOff = 0;
    const itemUpdates: { id: string; cost: number; recognised: number; movementId: string | null }[] = [];

    for (const it of ret.items) {
      const line = invoice.items.find((i) => i.id === it.invoiceItemId)!;
      const value = lineValue(invoice, line);
      const share = n(line.quantity) > 0 ? n(it.quantity) / n(line.quantity) : 0;
      const recognised = roundMoney(value * share);
      const unitCost = costByLine.get(line.id) || 0;
      const cost = roundMoney(unitCost * n(it.baseQuantity));
      let movementId: string | null = null;

      if (it.restock && cost >= 0) {
        const movement = await createStockMovement(
          user,
          {
            product_id: it.productId,
            variant_id: it.variantId,
            warehouse_id: ret.warehouseId,
            movement_type: 'sales_return',
            quantity_in: n(it.baseQuantity),
            unit_cost: unitCost || undefined,
            reference_type: 'sales_return',
            reference_id: ret.id,
            idempotency_key: `ret:${ret.id}:${it.id}`,
            reason: `${ret.returnNumber} for ${invoice.invoiceNumber}`
          },
          tx
        );
        movementId = movement.id;
        inventoryRestored = roundMoney(inventoryRestored + cost);
      } else if (cost > 0) {
        writeOff = roundMoney(writeOff + cost);
      }
      cogsTotal = roundMoney(cogsTotal + cost);
      itemUpdates.push({ id: it.id, cost, recognised, movementId });
    }

    const recognisedTotal = roundMoney(itemUpdates.reduce((s, u) => s + u.recognised, 0));
    const taxAmount =
      n(invoice.totalAmount) > 0
        ? roundMoney((recognisedTotal * n(invoice.taxAmount)) / n(invoice.totalAmount))
        : n(ret.taxAmount);
    const netRevenue = roundMoney(recognisedTotal - taxAmount);

    const common = {
      customer_id: invoice.customerId,
      sales_representative_id: invoice.salesRepId || undefined,
      source_type: 'sales_return',
      source_id: ret.id,
      post: true
    };

    // 1) Reverse revenue in the revenue branch: Dr sales_returns + tax, Cr AR
    const revLines: { account_id: string; debit?: number; credit?: number; description: string }[] = [
      {
        account_id: accountMap.sales_returns,
        debit: netRevenue,
        description: `Sales return ${ret.returnNumber}`
      }
    ];
    if (taxAmount > 0.009) {
      revLines.push({
        account_id: accountMap.tax_payable!,
        debit: taxAmount,
        description: `Tax reverse ${ret.returnNumber}`
      });
    }
    revLines.push({
      account_id: accountMap.accounts_receivable,
      credit: recognisedTotal,
      description: `AR reverse ${invoice.invoiceNumber}`
    });
    const revJ: any = await createJournal(
      user,
      {
        ...common,
        memo: `Sales return ${ret.returnNumber} (${invoice.invoiceNumber})`,
        idempotency_key: `sales_return_rev:${ret.id}`,
        branch_id: ret.revenueBranchId,
        lines: revLines
      },
      tx,
      { trustedBranch: true }
    );

    // 2) COGS / inventory
    let cogsJournalId: string | null = null;
    let inventoryJournalId: string | null = null;
    if (inventoryRestored > 0 || writeOff > 0) {
      if (writeOff > 0 && !accountMap.inventory_write_off) {
        throw httpError(400, 'Default account "inventory_write_off" is not configured for non-restocked returns');
      }
      const sameBranch = ret.branchId === ret.revenueBranchId;
      if (sameBranch) {
        const lines: { account_id: string; debit?: number; credit?: number; description: string }[] = [];
        if (inventoryRestored > 0) {
          lines.push({
            account_id: accountMap.inventory,
            debit: inventoryRestored,
            description: `Stock restored ${ret.returnNumber}`
          });
        }
        if (writeOff > 0) {
          lines.push({
            account_id: accountMap.inventory_write_off!,
            debit: writeOff,
            description: `Return write-off ${ret.returnNumber}`
          });
        }
        lines.push({
          account_id: accountMap.cogs,
          credit: roundMoney(inventoryRestored + writeOff),
          description: `COGS reverse ${ret.returnNumber}`
        });
        const j: any = await createJournal(
          user,
          {
            ...common,
            memo: `COGS reverse ${ret.returnNumber}`,
            idempotency_key: `sales_return_cogs:${ret.id}`,
            branch_id: ret.revenueBranchId,
            lines
          },
          tx,
          { trustedBranch: true }
        );
        cogsJournalId = j.id;
      } else {
        if (!accountMap.inter_branch_clearing) {
          throw httpError(400, 'Default account "inter_branch_clearing" is not configured');
        }
        const recvLines: { account_id: string; debit?: number; credit?: number; description: string }[] = [];
        if (inventoryRestored > 0) {
          recvLines.push({
            account_id: accountMap.inventory,
            debit: inventoryRestored,
            description: `Stock restored ${ret.returnNumber}`
          });
        }
        if (writeOff > 0) {
          recvLines.push({
            account_id: accountMap.inventory_write_off!,
            debit: writeOff,
            description: `Return write-off ${ret.returnNumber}`
          });
        }
        recvLines.push({
          account_id: accountMap.inter_branch_clearing,
          credit: roundMoney(inventoryRestored + writeOff),
          description: `Due to revenue branch — ${ret.returnNumber}`
        });
        const invJ: any = await createJournal(
          user,
          {
            ...common,
            memo: `Return stock ${ret.returnNumber}`,
            idempotency_key: `sales_return_inv:${ret.id}`,
            branch_id: ret.branchId,
            lines: recvLines
          },
          tx,
          { trustedBranch: true }
        );
        const cogsJ: any = await createJournal(
          user,
          {
            ...common,
            memo: `COGS reverse ${ret.returnNumber} (from ${ret.warehouse.code})`,
            idempotency_key: `sales_return_cogs:${ret.id}`,
            branch_id: ret.revenueBranchId,
            lines: [
              {
                account_id: accountMap.inter_branch_clearing,
                debit: roundMoney(inventoryRestored + writeOff),
                description: `Due from ${ret.warehouse.code} — ${ret.returnNumber}`
              },
              {
                account_id: accountMap.cogs,
                credit: roundMoney(inventoryRestored + writeOff),
                description: `COGS reverse ${ret.returnNumber}`
              }
            ]
          },
          tx,
          { trustedBranch: true }
        );
        inventoryJournalId = invJ.id;
        cogsJournalId = cogsJ.id;
      }
    }

    // 3) Update invoice lines + header
    for (const it of ret.items) {
      const upd = itemUpdates.find((u) => u.id === it.id)!;
      const line = invoice.items.find((i) => i.id === it.invoiceItemId)!;
      await tx.salesInvoiceItem.update({
        where: { id: line.id },
        data: {
          returnedQuantity: toDec(roundQty(n(line.returnedQuantity) + n(it.quantity))),
          recognisedAmount: toDec(roundMoney(Math.max(0, n(line.recognisedAmount) - upd.recognised)))
        }
      });
      await tx.salesReturnItem.update({
        where: { id: it.id },
        data: {
          cost: toDec(upd.cost),
          recognisedAmount: toDec(upd.recognised),
          stockMovementId: upd.movementId
        }
      });
    }

    const invFresh = await tx.salesInvoice.findUniqueOrThrow({ where: { id: invoice.id } });
    let newRecognised = roundMoney(Math.max(0, n(invFresh.recognisedAmount) - recognisedTotal));
    let newBalance = roundMoney(n(invFresh.balance) - recognisedTotal);
    let creditIssued = 0;
    let refundAmount = 0;
    let settlementJournalId: string | null = null;
    let creditPaymentId: string | null = null;

    // Credit on the invoice (balance negative) → unapplied customer credit or refund
    if (newBalance < -0.009) {
      const credit = roundMoney(-newBalance);
      if (settlement === 'refund') {
        if (!refundAccountId) throw httpError(400, 'refund_account_id is required');
        if (ret.branchId === ret.revenueBranchId) {
          const payJ: any = await createJournal(
            user,
            {
              ...common,
              memo: `Refund for return ${ret.returnNumber}`,
              idempotency_key: `sales_return_refund:${ret.id}`,
              branch_id: ret.revenueBranchId,
              lines: [
                {
                  account_id: accountMap.accounts_receivable,
                  debit: credit,
                  description: `Clear credit ${invoice.invoiceNumber}`
                },
                {
                  account_id: refundAccountId,
                  credit: credit,
                  description: `Customer refund ${ret.returnNumber}`
                }
              ]
            },
            tx,
            { trustedBranch: true }
          );
          settlementJournalId = payJ.id;
        } else {
          if (!accountMap.inter_branch_clearing) {
            throw httpError(400, 'Default account "inter_branch_clearing" is not configured');
          }
          await createJournal(
            user,
            {
              ...common,
              memo: `Refund AR clear ${ret.returnNumber}`,
              idempotency_key: `sales_return_refund_ar:${ret.id}`,
              branch_id: ret.revenueBranchId,
              lines: [
                {
                  account_id: accountMap.accounts_receivable,
                  debit: credit,
                  description: `Clear credit ${invoice.invoiceNumber}`
                },
                {
                  account_id: accountMap.inter_branch_clearing,
                  credit: credit,
                  description: `Refund via receiving branch`
                }
              ]
            },
            tx,
            { trustedBranch: true }
          );
          const cashJ: any = await createJournal(
            user,
            {
              ...common,
              memo: `Customer refund ${ret.returnNumber}`,
              idempotency_key: `sales_return_refund_cash:${ret.id}`,
              branch_id: ret.branchId,
              lines: [
                {
                  account_id: accountMap.inter_branch_clearing,
                  debit: credit,
                  description: `Refund for ${invoice.invoiceNumber}`
                },
                {
                  account_id: refundAccountId,
                  credit: credit,
                  description: `Customer refund ${ret.returnNumber}`
                }
              ]
            },
            tx,
            { trustedBranch: true }
          );
          settlementJournalId = cashJ.id;
        }
        refundAmount = credit;
        newBalance = 0;
        await tx.salesInvoice.update({
          where: { id: invoice.id },
          data: {
            amountPaid: toDec(roundMoney(Math.max(0, n(invFresh.amountPaid) - credit))),
            paymentStatus: paymentStatusFor(invFresh, roundMoney(Math.max(0, n(invFresh.amountPaid) - credit)))
          }
        });
      } else {
        // credit_note → unapplied customer credit
        if (!accountMap.unapplied_customer_receipts) {
          throw httpError(400, 'Default account "unapplied_customer_receipts" is not configured');
        }
        const creditJ: any = await createJournal(
          user,
          {
            ...common,
            memo: `Customer credit from return ${ret.returnNumber}`,
            idempotency_key: `sales_return_credit:${ret.id}`,
            branch_id: ret.revenueBranchId,
            lines: [
              {
                account_id: accountMap.accounts_receivable,
                debit: credit,
                description: `Clear credit ${invoice.invoiceNumber}`
              },
              {
                account_id: accountMap.unapplied_customer_receipts,
                credit: credit,
                description: `Unapplied credit ${ret.returnNumber}`
              }
            ]
          },
          tx,
          { trustedBranch: true }
        );
        settlementJournalId = creditJ.id;
        const paymentNumber = await nextDocNumber(
          tx.customerPayment,
          user.businessId,
          'paymentNumber',
          'CPAY',
          5
        );
        creditPaymentId = shortId('cpay');
        await tx.customerPayment.create({
          data: {
            id: creditPaymentId,
            businessId: user.businessId,
            branchId: ret.revenueBranchId,
            customerId: invoice.customerId,
            paymentNumber,
            paymentDate: new Date(),
            amount: toDec(0),
            method: 'credit_note',
            reference: ret.returnNumber,
            notes: `Credit from sales return ${ret.returnNumber}`,
            journalEntryId: creditJ.id,
            unappliedAmount: toDec(credit),
            idempotencyKey: `return_credit:${ret.id}`,
            createdById: user.id
          }
        });
        creditIssued = credit;
        newBalance = 0;
        await tx.salesInvoice.update({
          where: { id: invoice.id },
          data: {
            amountPaid: toDec(roundMoney(Math.max(0, n(invFresh.amountPaid) - credit))),
            paymentStatus: paymentStatusFor(invFresh, roundMoney(Math.max(0, n(invFresh.amountPaid) - credit)))
          }
        });
      }
    }

    const invAfterPay = await tx.salesInvoice.findUniqueOrThrow({ where: { id: invoice.id } });
    await tx.salesInvoice.update({
      where: { id: invoice.id },
      data: {
        recognisedAmount: toDec(newRecognised),
        balance: toDec(newBalance),
        paymentStatus: paymentStatusFor(
          { totalAmount: invAfterPay.totalAmount, cancelledAmount: invAfterPay.cancelledAmount },
          n(invAfterPay.amountPaid)
        )
      }
    });

    // Commission reduction
    const commission = await tx.salesCommission.findFirst({
      where: { invoiceId: invoice.id, status: 'accrued' }
    });
    if (commission) {
      const pct = n(commission.commissionPercent);
      const newBase = roundMoney(Math.max(0, n(commission.baseAmount) - recognisedTotal));
      await tx.salesCommission.update({
        where: { id: commission.id },
        data: {
          baseAmount: toDec(newBase),
          commissionAmount: toDec(roundMoney((newBase * pct) / 100))
        }
      });
    }

    await tx.salesReturn.update({
      where: { id: ret.id },
      data: {
        status: 'posted',
        reason,
        settlement,
        refundMethod: settlement === 'refund' ? refundMethod : null,
        refundAccountId: settlement === 'refund' ? refundAccountId : null,
        recognisedReversal: toDec(recognisedTotal),
        cogsReversal: toDec(cogsTotal),
        creditIssued: toDec(creditIssued),
        refundAmount: toDec(refundAmount),
        taxAmount: toDec(taxAmount),
        totalAmount: toDec(recognisedTotal),
        revenueJournalEntryId: revJ.id,
        cogsJournalEntryId: cogsJournalId,
        inventoryJournalEntryId: inventoryJournalId,
        settlementJournalEntryId: settlementJournalId,
        creditPaymentId,
        postedById: user.id,
        postedAt: new Date()
      }
    });

    return ret.id;
  }, TX);

  await writeAudit({
    user,
    module: 'sales',
    action: 'return_post',
    entityType: 'SalesReturn',
    entityId: postedId,
    summary: `Posted sales return ${postedId}`
  });

  return serialize(await loadReturn(prisma, user.businessId, postedId));
}

async function averageCostByLine(tx: Tx, invoiceId: string, fulfilmentId: string | null) {
  const where: Prisma.SalesFulfilmentItemWhereInput = {
    fulfilment: {
      invoiceId,
      status: { in: ['released', 'delivered'] },
      ...(fulfilmentId ? { id: fulfilmentId } : {})
    }
  };
  const rows = await tx.salesFulfilmentItem.findMany({
    where,
    select: { invoiceItemId: true, quantity: true, baseQuantity: true, cost: true }
  });
  const map = new Map<string, { cost: number; base: number }>();
  for (const r of rows) {
    const cur = map.get(r.invoiceItemId) || { cost: 0, base: 0 };
    cur.cost += n(r.cost);
    cur.base += n(r.baseQuantity);
    map.set(r.invoiceItemId, cur);
  }
  const out = new Map<string, number>();
  for (const [id, v] of map) {
    out.set(id, v.base > EPS ? v.cost / v.base : 0);
  }
  return out;
}

/** Eligible return lines for an invoice (qty still returnable). */
export async function returnPreview(user: AuthUser, invoiceId: string) {
  const invoice = await prisma.salesInvoice.findFirst({
    where: { id: invoiceId, businessId: user.businessId },
    include: {
      items: {
        include: {
          product: { select: { id: true, name: true, sku: true } },
          variant: { select: { id: true, name: true, sku: true } },
          uom: { select: { id: true, code: true, name: true } }
        }
      },
      fulfilments: {
        where: { status: { in: ['released', 'delivered'] } },
        select: {
          id: true,
          fulfilmentNumber: true,
          warehouseId: true,
          branchId: true,
          status: true,
          fulfilledAt: true,
          warehouse: { select: { id: true, code: true, name: true } }
        }
      },
      customer: { select: { id: true, name: true, code: true } },
      branch: { select: { id: true, name: true, code: true } }
    }
  });
  if (!invoice) throw httpError(404, 'Invoice not found');
  const lines = invoice.items
    .map((it) => ({
      invoice_item_id: it.id,
      product: it.product,
      variant: it.variant,
      uom: it.uom,
      quantity: n(it.quantity),
      fulfilled_quantity: n(it.fulfilledQuantity),
      returned_quantity: n(it.returnedQuantity),
      returnable_quantity: returnableQty(it),
      unit_price: n(it.unitPrice),
      line_total: n(it.lineTotal),
      recognised_amount: n(it.recognisedAmount)
    }))
    .filter((l) => l.returnable_quantity > EPS);
  return serialize({
    invoice: {
      id: invoice.id,
      invoice_number: invoice.invoiceNumber,
      customer: invoice.customer,
      revenue_branch: invoice.branch,
      recognised_amount: n(invoice.recognisedAmount),
      balance: n(invoice.balance),
      amount_paid: n(invoice.amountPaid),
      recognition_policy: invoice.recognitionPolicy
    },
    fulfilments: invoice.fulfilments,
    lines
  });
}
