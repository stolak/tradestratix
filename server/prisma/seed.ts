import bcrypt from 'bcryptjs';
import { PrismaClient } from '@prisma/client';
import { v4 as uuidv4 } from 'uuid';
import dotenv from 'dotenv';

dotenv.config();

const prisma = new PrismaClient();

function id(prefix: string) {
  return `${prefix}-${uuidv4().slice(0, 8)}`;
}

const MODULES = [
  'dashboard',
  'sales',
  'pos',
  'purchases',
  'products',
  'inventory',
  'warehouses',
  'suppliers',
  'customers',
  'sales_reps',
  'distribution',
  'accounting',
  'banking',
  'expenses',
  'assets',
  'hr',
  'payroll',
  'reports',
  'settings',
  'users',
  'roles',
  'branches',
  'audit'
];

const ACTIONS = [
  'view',
  'create',
  'edit',
  'delete',
  'approve',
  'reject',
  'post',
  'reverse',
  'export',
  'print'
];

const SYSTEM_ROLES = [
  { code: 'business_owner', name: 'Business Owner', sortOrder: 1 },
  { code: 'managing_director', name: 'Managing Director', sortOrder: 2 },
  { code: 'general_manager', name: 'General Manager', sortOrder: 3 },
  { code: 'branch_manager', name: 'Branch Manager', sortOrder: 4 },
  { code: 'warehouse_manager', name: 'Warehouse Manager', sortOrder: 5 },
  { code: 'inventory_officer', name: 'Inventory Officer', sortOrder: 6 },
  { code: 'procurement_officer', name: 'Procurement Officer', sortOrder: 7 },
  { code: 'sales_manager', name: 'Sales Manager', sortOrder: 8 },
  { code: 'sales_representative', name: 'Sales Representative', sortOrder: 9 },
  { code: 'cashier', name: 'Cashier', sortOrder: 10 },
  { code: 'accountant', name: 'Accountant', sortOrder: 11 },
  { code: 'finance_manager', name: 'Finance Manager', sortOrder: 12 },
  { code: 'hr_manager', name: 'HR Manager', sortOrder: 13 },
  { code: 'payroll_officer', name: 'Payroll Officer', sortOrder: 14 },
  { code: 'auditor', name: 'Auditor', sortOrder: 15 },
  { code: 'delivery_officer', name: 'Delivery Officer', sortOrder: 16 }
];

const MENUS = [
  { code: 'dashboard', name: 'Dashboard', route: 'dashboard', section: 'Overview', sortOrder: 1, icon: 'LayoutDashboard' },
  { code: 'sales', name: 'Sales', route: 'sales', section: 'Commerce', sortOrder: 10, icon: 'ShoppingCart' },
  { code: 'pos', name: 'POS', route: 'pos', section: 'Commerce', sortOrder: 11, icon: 'Monitor' },
  { code: 'purchases', name: 'Purchases', route: 'purchases', section: 'Commerce', sortOrder: 12, icon: 'Truck' },
  { code: 'products', name: 'Products', route: 'products', section: 'Inventory', sortOrder: 20, icon: 'Package' },
  { code: 'inventory', name: 'Inventory', route: 'inventory', section: 'Inventory', sortOrder: 21, icon: 'Boxes' },
  { code: 'warehouses', name: 'Warehouses', route: 'warehouses', section: 'Inventory', sortOrder: 22, icon: 'Warehouse' },
  { code: 'suppliers', name: 'Suppliers', route: 'suppliers', section: 'Partners', sortOrder: 30, icon: 'Factory' },
  { code: 'customers', name: 'Customers', route: 'customers', section: 'Partners', sortOrder: 31, icon: 'Users' },
  { code: 'sales_reps', name: 'Sales Reps', route: 'sales_reps', section: 'Partners', sortOrder: 32, icon: 'UserCheck' },
  { code: 'distribution', name: 'Distribution', route: 'distribution', section: 'Logistics', sortOrder: 40, icon: 'Route' },
  { code: 'accounting', name: 'Accounting', route: 'accounting', section: 'Finance', sortOrder: 50, icon: 'BookOpen' },
  { code: 'banking', name: 'Banking', route: 'banking', section: 'Finance', sortOrder: 51, icon: 'Landmark' },
  { code: 'expenses', name: 'Expenses', route: 'expenses', section: 'Finance', sortOrder: 52, icon: 'Receipt' },
  { code: 'assets', name: 'Assets', route: 'assets', section: 'Finance', sortOrder: 53, icon: 'Building2' },
  { code: 'hr', name: 'Human Resources', route: 'hr', section: 'People', sortOrder: 60, icon: 'BadgeCheck' },
  { code: 'payroll', name: 'Payroll', route: 'payroll', section: 'People', sortOrder: 61, icon: 'Wallet' },
  { code: 'reports', name: 'Reports', route: 'reports', section: 'Insights', sortOrder: 70, icon: 'BarChart3' },
  { code: 'branches', name: 'Branches', route: 'branches', section: 'Settings', sortOrder: 80, icon: 'MapPin' },
  { code: 'users', name: 'Users', route: 'users', section: 'Settings', sortOrder: 81, icon: 'UserCog' },
  { code: 'roles', name: 'Roles', route: 'roles', section: 'Settings', sortOrder: 82, icon: 'Shield' },
  { code: 'settings', name: 'Business Settings', route: 'settings', section: 'Settings', sortOrder: 83, icon: 'Settings' },
  { code: 'audit', name: 'Audit Log', route: 'audit', section: 'Settings', sortOrder: 84, icon: 'ScrollText' }
];

const COA: { code: string; name: string; accountType: string; key?: string }[] = [
  { code: '1000', name: 'Assets', accountType: 'asset' },
  { code: '1100', name: 'Current Assets', accountType: 'asset' },
  { code: '1110', name: 'Cash on Hand', accountType: 'asset', key: 'cash' },
  { code: '1120', name: 'Bank Account', accountType: 'asset', key: 'bank' },
  { code: '1130', name: 'Accounts Receivable', accountType: 'asset', key: 'accounts_receivable' },
  { code: '1140', name: 'Inventory Asset', accountType: 'asset', key: 'inventory' },
  { code: '1200', name: 'Fixed Assets', accountType: 'asset' },
  { code: '1210', name: 'Property, Plant & Equipment', accountType: 'asset', key: 'fixed_assets' },
  { code: '1220', name: 'Accumulated Depreciation', accountType: 'asset', key: 'accumulated_depreciation' },
  { code: '2000', name: 'Liabilities', accountType: 'liability' },
  { code: '2100', name: 'Accounts Payable', accountType: 'liability', key: 'accounts_payable' },
  { code: '2200', name: 'VAT Payable', accountType: 'liability', key: 'tax_payable' },
  { code: '2300', name: 'Salary Payable', accountType: 'liability', key: 'salary_payable' },
  { code: '2400', name: 'PAYE Payable', accountType: 'liability', key: 'paye_payable' },
  { code: '2500', name: 'Pension Payable', accountType: 'liability', key: 'pension_payable' },
  { code: '3000', name: 'Equity', accountType: 'equity' },
  { code: '3100', name: 'Owner Equity', accountType: 'equity', key: 'equity' },
  { code: '3200', name: 'Retained Earnings', accountType: 'equity', key: 'retained_earnings' },
  { code: '4000', name: 'Revenue', accountType: 'revenue' },
  { code: '4100', name: 'Sales Revenue', accountType: 'revenue', key: 'sales_revenue' },
  { code: '4200', name: 'Sales Returns', accountType: 'revenue', key: 'sales_returns' },
  { code: '5000', name: 'Cost of Goods Sold', accountType: 'cogs', key: 'cogs' },
  { code: '6000', name: 'Operating Expenses', accountType: 'expense' },
  { code: '6100', name: 'Salaries Expense', accountType: 'expense', key: 'salary_expense' },
  { code: '6200', name: 'Rent Expense', accountType: 'expense', key: 'rent_expense' },
  { code: '6300', name: 'Depreciation Expense', accountType: 'expense', key: 'depreciation_expense' },
  { code: '6400', name: 'General Expenses', accountType: 'expense', key: 'expense' }
];

async function main() {
  console.log('Seeding TradeStratix...');

  // Permissions (global)
  const permissionIds: Record<string, string> = {};
  let sort = 0;
  for (const mod of MODULES) {
    for (const action of ACTIONS) {
      const code = `${mod}.${action}`;
      const existing = await prisma.permission.findUnique({ where: { code } });
      if (existing) {
        permissionIds[code] = existing.id;
        continue;
      }
      const row = await prisma.permission.create({
        data: {
          id: id('perm'),
          code,
          name: `${mod} ${action}`,
          module: mod,
          action,
          sortOrder: sort++
        }
      });
      permissionIds[code] = row.id;
    }
  }

  // System roles (platform-wide templates, businessId null)
  const roleIds: Record<string, string> = {};
  for (const r of SYSTEM_ROLES) {
    let role = await prisma.role.findFirst({ where: { code: r.code, businessId: null } });
    if (!role) {
      role = await prisma.role.create({
        data: {
          id: id('role'),
          businessId: null,
          code: r.code,
          name: r.name,
          isSystem: true,
          sortOrder: r.sortOrder,
          description: `System role: ${r.name}`
        }
      });
    }
    roleIds[r.code] = role.id;
  }

  // Menus
  const menuIds: Record<string, string> = {};
  for (const m of MENUS) {
    let menu = await prisma.menu.findFirst({ where: { code: m.code, businessId: null } });
    if (!menu) {
      menu = await prisma.menu.create({
        data: {
          id: id('menu'),
          businessId: null,
          code: m.code,
          name: m.name,
          route: m.route,
          section: m.section,
          icon: m.icon,
          sortOrder: m.sortOrder
        }
      });
    }
    menuIds[m.code] = menu.id;
  }

  // Grant all permissions + menus to business_owner
  const ownerRoleId = roleIds.business_owner;
  for (const permId of Object.values(permissionIds)) {
    await prisma.rolePermission.upsert({
      where: { roleId_permissionId: { roleId: ownerRoleId, permissionId: permId } },
      create: { roleId: ownerRoleId, permissionId: permId },
      update: {}
    });
  }
  for (const menuId of Object.values(menuIds)) {
    await prisma.roleMenu.upsert({
      where: { roleId_menuId: { roleId: ownerRoleId, menuId } },
      create: { roleId: ownerRoleId, menuId },
      update: {}
    });
  }

  // Auditor: view/export only
  const auditorRoleId = roleIds.auditor;
  for (const [code, permId] of Object.entries(permissionIds)) {
    if (code.endsWith('.view') || code.endsWith('.export') || code.endsWith('.print')) {
      await prisma.rolePermission.upsert({
        where: { roleId_permissionId: { roleId: auditorRoleId, permissionId: permId } },
        create: { roleId: auditorRoleId, permissionId: permId },
        update: {}
      });
    }
  }
  for (const menuId of Object.values(menuIds)) {
    await prisma.roleMenu.upsert({
      where: { roleId_menuId: { roleId: auditorRoleId, menuId } },
      create: { roleId: auditorRoleId, menuId },
      update: {}
    });
  }

  // Subscription plan
  let plan = await prisma.subscriptionPlan.findUnique({ where: { code: 'growth' } });
  if (!plan) {
    plan = await prisma.subscriptionPlan.create({
      data: {
        id: id('plan'),
        code: 'growth',
        name: 'Growth',
        description: 'Multi-branch wholesale/retail starter plan',
        monthlyPrice: 75000,
        yearlyPrice: 750000,
        maxUsers: 25,
        maxBranches: 10,
        maxWarehouses: 30,
        modulesJson: JSON.stringify(MODULES)
      }
    });
  }

  const currency = process.env.SEED_CURRENCY || 'NGN';

  // Demo business
  let business = await prisma.business.findFirst({ where: { name: 'Demo Distribution Co.' } });
  if (!business) {
    business = await prisma.business.create({
      data: {
        id: id('biz'),
        name: 'Demo Distribution Co.',
        legalName: 'Demo Distribution Company Ltd',
        registrationNumber: 'RC-DEMO-001',
        taxId: 'TIN-DEMO-001',
        email: 'ops@demodistro.local',
        phone: '+2348000000000',
        addressLine1: '12 Warehouse Road',
        city: 'Lagos',
        state: 'Lagos',
        country: 'NG',
        businessType: 'distributor_retailer',
        defaultCurrency: currency,
        inventoryValuation: 'weighted_average',
        enabledModulesJson: JSON.stringify(MODULES),
        status: 'active'
      }
    });
  }

  await prisma.businessCurrency.upsert({
    where: { businessId_code: { businessId: business.id, code: currency } },
    create: {
      id: id('cur'),
      businessId: business.id,
      code: currency,
      name: currency === 'NGN' ? 'Nigerian Naira' : currency,
      symbol: currency === 'NGN' ? '₦' : currency,
      isDefault: true,
      exchangeRate: 1
    },
    update: { isDefault: true }
  });

  await prisma.businessSubscription.create({
    data: {
      id: id('sub'),
      businessId: business.id,
      planId: plan.id,
      status: 'trial',
      startsAt: new Date(),
      trialEndsAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
    }
  }).catch(() => undefined);

  // Branch + warehouse
  let branch = await prisma.branch.findFirst({
    where: { businessId: business.id, code: 'HQ' }
  });
  if (!branch) {
    branch = await prisma.branch.create({
      data: {
        id: id('br'),
        businessId: business.id,
        name: 'Lagos HQ',
        code: 'HQ',
        city: 'Lagos',
        state: 'Lagos',
        country: 'NG',
        addressLine1: '12 Warehouse Road'
      }
    });
  }

  let warehouse = await prisma.warehouse.findFirst({
    where: { businessId: business.id, code: 'MAIN' }
  });
  if (!warehouse) {
    warehouse = await prisma.warehouse.create({
      data: {
        id: id('wh'),
        businessId: business.id,
        branchId: branch.id,
        name: 'Main Warehouse',
        code: 'MAIN',
        category: 'main'
      }
    });
  }

  // Owner user
  const passwordHash = await bcrypt.hash('password123', 10);
  let owner = await prisma.user.findFirst({
    where: { businessId: business.id, username: 'owner' }
  });
  if (!owner) {
    owner = await prisma.user.create({
      data: {
        id: id('usr'),
        businessId: business.id,
        username: 'owner',
        passwordHash,
        fullName: 'Ada Okoro',
        role: 'business_owner',
        email: 'owner@demodistro.local',
        defaultBranchId: branch.id,
        userRoles: { create: [{ roleId: ownerRoleId }] },
        userBranches: { create: [{ branchId: branch.id }] }
      }
    });
  }

  // Chart of accounts for business
  const accountByCode: Record<string, string> = {};
  const parentByType: Record<string, string | null> = {};
  for (const a of COA) {
    let acc = await prisma.account.findFirst({
      where: { businessId: business.id, code: a.code }
    });
    if (!acc) {
      const parentId =
        a.code.length === 4 && a.code.endsWith('000')
          ? null
          : a.code.endsWith('00')
            ? parentByType[`${a.accountType}-root`] || null
            : parentByType[`${a.accountType}-group`] || parentByType[`${a.accountType}-root`] || null;

      // Simple hierarchy: x000 root, x?00 group under root
      let resolvedParent: string | null = null;
      if (a.code === '1000' || a.code === '2000' || a.code === '3000' || a.code === '4000' || a.code === '5000' || a.code === '6000') {
        resolvedParent = null;
        parentByType[`${a.accountType}-root`] = undefined as any;
      } else if (a.code.endsWith('00')) {
        const rootCode = a.code[0] + '000';
        resolvedParent = accountByCode[rootCode] || null;
        parentByType[`${a.accountType}-group`] = undefined as any;
      } else {
        const groupCode = a.code.slice(0, 2) + '00';
        resolvedParent = accountByCode[groupCode] || accountByCode[a.code[0] + '000'] || null;
      }

      acc = await prisma.account.create({
        data: {
          id: id('acc'),
          businessId: business.id,
          code: a.code,
          name: a.name,
          accountType: a.accountType,
          parentId: resolvedParent,
          isSystem: true
        }
      });
    }
    accountByCode[a.code] = acc.id;
    if (a.code.endsWith('000')) parentByType[`${a.accountType}-root`] = acc.id;
    if (a.code.endsWith('00') && !a.code.endsWith('000')) parentByType[`${a.accountType}-group`] = acc.id;

    if (a.key) {
      await prisma.defaultAccountSetting.upsert({
        where: {
          businessId_settingKey: { businessId: business.id, settingKey: a.key }
        },
        create: {
          id: id('das'),
          businessId: business.id,
          settingKey: a.key,
          accountId: acc.id
        },
        update: { accountId: acc.id }
      });
    }
  }

  // Financial year
  const year = new Date().getFullYear();
  let fy = await prisma.financialYear.findFirst({
    where: { businessId: business.id, name: `FY ${year}` }
  });
  if (!fy) {
    fy = await prisma.financialYear.create({
      data: {
        id: id('fy'),
        businessId: business.id,
        name: `FY ${year}`,
        startsOn: new Date(`${year}-01-01`),
        endsOn: new Date(`${year}-12-31`)
      }
    });
    for (let m = 1; m <= 12; m++) {
      const startsOn = new Date(year, m - 1, 1);
      const endsOn = new Date(year, m, 0);
      await prisma.accountingPeriod.create({
        data: {
          id: id('ap'),
          businessId: business.id,
          financialYearId: fy.id,
          name: startsOn.toLocaleString('en', { month: 'long' }),
          periodNo: m,
          startsOn,
          endsOn
        }
      });
    }
  }

  // ─── Phase 2: UoM, categories, products, opening stock ───────────────────
  const uomDefs = [
    { code: 'PCS', name: 'Piece', unitCategory: 'Count', allowsDecimal: false },
    { code: 'CTN', name: 'Carton', unitCategory: 'Packaging', allowsDecimal: false },
    { code: 'PK', name: 'Pack', unitCategory: 'Packaging', allowsDecimal: false },
    { code: 'BTL', name: 'Bottle', unitCategory: 'Count', allowsDecimal: false },
    { code: 'KG', name: 'Kilogram', unitCategory: 'Weight', allowsDecimal: true },
    { code: 'G', name: 'Gram', unitCategory: 'Weight', allowsDecimal: true },
    { code: 'L', name: 'Litre', unitCategory: 'Volume', allowsDecimal: true },
    { code: 'ML', name: 'Millilitre', unitCategory: 'Volume', allowsDecimal: true },
    { code: 'M', name: 'Metre', unitCategory: 'Length', allowsDecimal: true },
    { code: 'DZ', name: 'Dozen', unitCategory: 'Packaging', allowsDecimal: false }
  ];
  const uomIds: Record<string, string> = {};
  for (const u of uomDefs) {
    let row = await prisma.unitOfMeasure.findFirst({
      where: { businessId: business.id, code: u.code }
    });
    if (!row) {
      row = await prisma.unitOfMeasure.create({
        data: { id: id('uom'), businessId: business.id, ...u }
      });
    }
    uomIds[u.code] = row.id;
  }

  let beverages = await prisma.productCategory.findFirst({
    where: { businessId: business.id, name: 'Beverages' }
  });
  if (!beverages) {
    beverages = await prisma.productCategory.create({
      data: { id: id('cat'), businessId: business.id, name: 'Beverages', code: 'BEV' }
    });
  }
  let fashion = await prisma.productCategory.findFirst({
    where: { businessId: business.id, name: 'Fashion' }
  });
  if (!fashion) {
    fashion = await prisma.productCategory.create({
      data: { id: id('cat'), businessId: business.id, name: 'Fashion', code: 'FSH' }
    });
  }
  let brandNike = await prisma.brand.findFirst({
    where: { businessId: business.id, name: 'Nike' }
  });
  if (!brandNike) {
    brandNike = await prisma.brand.create({
      data: { id: id('brd'), businessId: business.id, name: 'Nike', code: 'NIKE' }
    });
  }

  let soda = await prisma.product.findFirst({
    where: { businessId: business.id, sku: 'BEV-SODA-500' }
  });
  if (!soda) {
    soda = await prisma.product.create({
      data: {
        id: id('prd'),
        businessId: business.id,
        name: 'Sparkle Cola 500ml',
        sku: 'BEV-SODA-500',
        barcode: '6001234567890',
        categoryId: beverages.id,
        trackingMode: 'expiry',
        trackBatch: true,
        trackExpiry: true,
        baseUomId: uomIds.BTL,
        purchaseUomId: uomIds.CTN,
        sellingUomId: uomIds.BTL,
        reorderLevel: 48,
        minStock: 24,
        defaultPurchaseCost: 150,
        defaultSellingPrice: 250,
        wholesalePrice: 220,
        retailPrice: 250,
        expiryAlertDaysJson: JSON.stringify([180, 90, 60, 30, 7]),
        variants: {
          create: [
            {
              id: id('var'),
              businessId: business.id,
              name: 'Default',
              sku: 'BEV-SODA-500-DEF',
              isDefault: true,
              purchaseCost: 150,
              sellingPrice: 250
            }
          ]
        },
        conversions: {
          create: [
            {
              id: id('puc'),
              businessId: business.id,
              fromUomId: uomIds.CTN,
              toUomId: uomIds.BTL,
              factor: 24
            },
            {
              id: id('puc'),
              businessId: business.id,
              fromUomId: uomIds.PK,
              toUomId: uomIds.BTL,
              factor: 6
            }
          ]
        }
      },
      include: { variants: true }
    });
  }

  let tee = await prisma.product.findFirst({
    where: { businessId: business.id, sku: 'NIK-TEE' }
  });
  if (!tee) {
    tee = await prisma.product.create({
      data: {
        id: id('prd'),
        businessId: business.id,
        name: 'Nike T-Shirt',
        sku: 'NIK-TEE',
        categoryId: fashion.id,
        brandId: brandNike.id,
        trackingMode: 'size_colour',
        hasVariants: true,
        baseUomId: uomIds.PCS,
        purchaseUomId: uomIds.PCS,
        sellingUomId: uomIds.PCS,
        reorderLevel: 10,
        defaultPurchaseCost: 4500,
        defaultSellingPrice: 7500,
        retailPrice: 7500,
        variants: {
          create: [
            {
              id: id('var'),
              businessId: business.id,
              name: 'Black / M',
              sku: 'NIK-BLK-M',
              colour: 'Black',
              size: 'M',
              isDefault: true,
              purchaseCost: 4500,
              sellingPrice: 7500
            },
            {
              id: id('var'),
              businessId: business.id,
              name: 'Black / L',
              sku: 'NIK-BLK-L',
              colour: 'Black',
              size: 'L',
              purchaseCost: 4500,
              sellingPrice: 7500
            },
            {
              id: id('var'),
              businessId: business.id,
              name: 'White / M',
              sku: 'NIK-WHT-M',
              colour: 'White',
              size: 'M',
              purchaseCost: 4500,
              sellingPrice: 7500
            },
            {
              id: id('var'),
              businessId: business.id,
              name: 'White / L',
              sku: 'NIK-WHT-L',
              colour: 'White',
              size: 'L',
              purchaseCost: 4500,
              sellingPrice: 7500
            }
          ]
        }
      },
      include: { variants: true }
    });
  }

  // Opening stock via inventory engine rules (direct lot+movement for seed speed)
  const sodaVar = await prisma.productVariant.findFirst({
    where: { productId: soda.id, isDefault: true }
  });
  if (sodaVar) {
    const existingLot = await prisma.stockLot.findFirst({
      where: { businessId: business.id, variantId: sodaVar.id, batchNumber: 'BATCH-A1' }
    });
    if (!existingLot) {
      const exp1 = new Date();
      exp1.setMonth(exp1.getMonth() + 8);
      const exp2 = new Date();
      exp2.setMonth(exp2.getMonth() + 3);
      for (const [batch, exp, qty, cost] of [
        ['BATCH-A1', exp1.toISOString().slice(0, 10), 120, 150],
        ['BATCH-B2', exp2.toISOString().slice(0, 10), 60, 155]
      ] as const) {
        const lotKey = `${sodaVar.id}|${warehouse.id}|${batch}|${exp}`;
        const lot = await prisma.stockLot.create({
          data: {
            id: id('lot'),
            businessId: business.id,
            productId: soda.id,
            variantId: sodaVar.id,
            warehouseId: warehouse.id,
            lotKey,
            batchNumber: batch,
            expiryDate: exp,
            quantityOnHand: qty,
            unitCost: cost
          }
        });
        await prisma.stockMovement.create({
          data: {
            id: id('sm'),
            businessId: business.id,
            productId: soda.id,
            variantId: sodaVar.id,
            warehouseId: warehouse.id,
            lotId: lot.id,
            movementType: 'opening',
            quantityIn: qty,
            unitCost: cost,
            totalCost: cost * qty,
            batchNumber: batch,
            expiryDate: exp,
            reason: 'Opening balance',
            performedById: owner.id,
            performedByName: owner.fullName,
            idempotencyKey: `opening:${lot.id}`
          }
        });
      }
    }
  }

  const teeVars = await prisma.productVariant.findMany({ where: { productId: tee.id } });
  for (const v of teeVars) {
    const exists = await prisma.stockLot.findFirst({
      where: { businessId: business.id, variantId: v.id }
    });
    if (exists) continue;
    const lotKey = `${v.id}|${warehouse.id}|BULK|NONE`;
    const lot = await prisma.stockLot.create({
      data: {
        id: id('lot'),
        businessId: business.id,
        productId: tee.id,
        variantId: v.id,
        warehouseId: warehouse.id,
        lotKey,
        batchNumber: 'BULK',
        quantityOnHand: 25,
        unitCost: 4500
      }
    });
    await prisma.stockMovement.create({
      data: {
        id: id('sm'),
        businessId: business.id,
        productId: tee.id,
        variantId: v.id,
        warehouseId: warehouse.id,
        lotId: lot.id,
        movementType: 'opening',
        quantityIn: 25,
        unitCost: 4500,
        totalCost: 112500,
        batchNumber: 'BULK',
        reason: 'Opening balance',
        performedById: owner.id,
        performedByName: owner.fullName,
        idempotencyKey: `opening:${lot.id}`
      }
    });
  }

  console.log('Seed complete.');
  console.log('Login: owner / password123');
  console.log(`Business: ${business.name} (${business.id})`);
  console.log(`Branch: ${branch.code} | Warehouse: ${warehouse.code}`);
  console.log('Phase 2 samples: Sparkle Cola (expiry batches), Nike T-Shirt (size/colour variants)');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
