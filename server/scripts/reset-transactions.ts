/**
 * Wipe all transactional / operational rows while keeping master data and access control.
 *
 * Kept: businesses, branches, warehouses, chart of accounts, periods, products & pricing,
 * customers, suppliers, sales reps, employees, users, roles, permissions, menus,
 * memberships / overrides, bank accounts, vehicles, SaaS plans/subscriptions, settings.
 *
 * Cleared: sales / purchases / stock movements, lots & serials / journals / banking txns /
 * expenses / assets & budgets / payroll & attendance / deliveries / audit & sessions /
 * notifications / customer notes.
 *
 * Usage (from server/):
 *   npm run reset:transactions
 *   npm run reset:transactions -- --dry
 */
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { PrismaClient } from '@prisma/client';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const dry = process.argv.includes('--dry');

/** MySQL table names (@@map) — delete order does not matter with FK checks off. */
const TRANSACTION_TABLES = [
  // Sales fulfilment & POD
  'fulfilment_proofs',
  'pickup_verifications',
  'sales_fulfilment_items',
  'sales_fulfilments',
  'sales_reservations',
  'sales_order_amendments',
  'sales_return_items',
  'sales_returns',
  'sales_commissions',
  'customer_payment_allocations',
  'customer_payments',
  'sales_invoice_items',
  'sales_invoices',
  'customer_notes',

  // Distribution
  'delivery_order_items',
  'delivery_orders',

  // Purchasing / AP
  'supplier_payment_allocations',
  'supplier_payments',
  'goods_receipt_items',
  'goods_receipt_notes',
  'purchase_order_items',
  'purchase_orders',
  'supplier_bills',

  // Inventory movements (products / warehouses kept)
  'stock_transfer_items',
  'stock_transfers',
  'stock_movements',
  'stock_serials',
  'stock_lots',

  // Banking / expenses / assets / budgets
  'bank_transactions',
  'expense_bill_lines',
  'expense_bills',
  'depreciation_entries',
  'fixed_assets',
  'budget_lines',
  'budgets',

  // HR transactional (employees kept — sales reps depend on them)
  'payroll_items',
  'payroll_runs',
  'leave_requests',
  'attendance_records',

  // GL
  'journal_lines',
  'journal_entries',

  // Ops noise
  'app_notifications',
  'audit_logs',
  'login_history',
  'refresh_tokens'
] as const;

async function main() {
  const prisma = new PrismaClient();
  try {
    console.log(dry ? 'Dry run — counting rows only.\n' : 'Resetting transactional tables…\n');

    const counts: { table: string; before: number }[] = [];
    for (const table of TRANSACTION_TABLES) {
      const rows = await prisma.$queryRawUnsafe<Array<{ c: bigint | number }>>(
        `SELECT COUNT(*) AS c FROM \`${table}\``
      );
      const before = Number(rows[0]?.c ?? 0);
      counts.push({ table, before });
    }

    if (dry) {
      for (const { table, before } of counts) {
        console.log(`  ${table.padEnd(36)} ${before}`);
      }
      const total = counts.reduce((s, r) => s + r.before, 0);
      console.log(`\nWould delete ${total} row(s) across ${counts.length} tables.`);
      console.log('Kept: customers, suppliers, sales_reps, users, roles, permissions, menus, products, branches, warehouses, accounts, employees, bank_accounts, vehicles, …');
      return;
    }

    await prisma.$executeRawUnsafe('SET FOREIGN_KEY_CHECKS = 0');
    try {
      for (const { table, before } of counts) {
        await prisma.$executeRawUnsafe(`TRUNCATE TABLE \`${table}\``);
        console.log(`  truncated ${table.padEnd(36)} (was ${before})`);
      }
    } finally {
      await prisma.$executeRawUnsafe('SET FOREIGN_KEY_CHECKS = 1');
    }

    const total = counts.reduce((s, r) => s + r.before, 0);
    console.log(`\nDone. Cleared ${total} transactional row(s) from ${counts.length} tables.`);
    console.log('Preserved customers, suppliers, sales representatives, users, roles & privileges, and other master data.');
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
