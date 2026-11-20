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
import { netBookValue } from './asset.service.js';
import * as branchAccess from './branch-access.service.js';

const projectInclude = {
  category: { select: { id: true, code: true, name: true, costAccountId: true, cipAccountId: true } },
  capitalisedAsset: { select: { id: true, code: true, name: true } },
  costs: { orderBy: { costDate: 'desc' as const } }
};

async function nextProjectNumber(businessId: string) {
  return nextDocNumber(prisma.capitalProject, businessId, 'projectNumber', 'CIP', 5);
}

async function recordEvent(opts: {
  businessId: string;
  assetId?: string | null;
  eventType: string;
  sourceType: string;
  sourceId: string;
  amount: number;
  journalEntryId?: string | null;
  summary?: string;
  createdById?: string | null;
  tx?: any;
}) {
  const db = opts.tx || prisma;
  await db.assetAccountingEvent.create({
    data: {
      id: shortId('aae'),
      businessId: opts.businessId,
      assetId: opts.assetId || null,
      eventType: opts.eventType,
      sourceType: opts.sourceType,
      sourceId: opts.sourceId,
      amount: toDec(roundMoney(opts.amount)),
      journalEntryId: opts.journalEntryId || null,
      summary: opts.summary || null,
      createdById: opts.createdById || null
    }
  });
}

export async function listProjects(user: AuthUser, opts?: { status?: string }) {
  const scope = await branchAccess.branchScopeWhereLoose(user, { allowConsolidated: true });
  const rows = await prisma.capitalProject.findMany({
    where: {
      businessId: user.businessId,
      ...scope,
      ...(opts?.status ? { status: opts.status } : {})
    },
    include: projectInclude,
    orderBy: { createdAt: 'desc' },
    take: 100
  });
  return serialize(rows);
}

export async function getProject(user: AuthUser, id: string) {
  const row = await prisma.capitalProject.findFirst({
    where: { id, businessId: user.businessId },
    include: projectInclude
  });
  if (!row) throw httpError(404, 'Capital project not found');
  return serialize(row);
}

export async function createProject(user: AuthUser, body: Record<string, any>) {
  const name = requireString(body.name, 'name');
  const projectNumber = await nextProjectNumber(user.businessId);
  const categoryId = body.category_id || body.categoryId || null;
  if (categoryId) {
    const cat = await prisma.assetCategory.findFirst({
      where: { id: categoryId, businessId: user.businessId }
    });
    if (!cat) throw httpError(400, 'Invalid category_id');
  }
  const row = await prisma.capitalProject.create({
    data: {
      id: shortId('cip'),
      businessId: user.businessId,
      branchId: body.branch_id || body.branchId || user.activeBranchId || null,
      projectNumber,
      name,
      description: body.description || null,
      categoryId,
      status: 'draft',
      startDate: body.start_date || body.startDate ? new Date(body.start_date || body.startDate) : new Date(),
      notes: body.notes || null,
      createdById: user.id
    },
    include: projectInclude
  });
  await writeAudit({
    user,
    action: 'create',
    module: 'assets',
    entityType: 'CapitalProject',
    entityId: row.id,
    summary: `Created CIP project ${projectNumber}`
  });
  return serialize(row);
}

export async function activateProject(user: AuthUser, id: string) {
  const existing = await prisma.capitalProject.findFirst({
    where: { id, businessId: user.businessId }
  });
  if (!existing) throw httpError(404, 'Capital project not found');
  if (existing.status !== 'draft') throw httpError(400, 'Only draft projects can be activated');
  const updated = await prisma.capitalProject.update({
    where: { id },
    data: { status: 'active' },
    include: projectInclude
  });
  return serialize(updated);
}

export async function addProjectCost(user: AuthUser, id: string, body: Record<string, any>) {
  const project = await prisma.capitalProject.findFirst({
    where: { id, businessId: user.businessId },
    include: { category: true }
  });
  if (!project) throw httpError(404, 'Capital project not found');
  if (!['draft', 'active'].includes(project.status)) {
    throw httpError(400, 'Costs can only be added to draft/active projects');
  }
  const amount = roundMoney(Number(body.amount));
  if (!(amount > 0)) throw httpError(400, 'amount must be > 0');
  const fundingMethod = String(body.funding_method || body.fundingMethod || 'bank');
  const costDate = new Date(body.cost_date || body.costDate || new Date());
  if (Number.isNaN(costDate.getTime())) throw httpError(400, 'Invalid cost_date');

  const map = await getDefaultAccountMap(user.businessId);
  const cipAccountId = project.category?.cipAccountId || map.asset_cip || null;
  if (!cipAccountId) throw httpError(400, 'asset_cip GL account is not configured');

  let creditAccountId: string | null = null;
  let creditDesc = `Fund ${fundingMethod}`;
  const bankAccountId = body.bank_account_id || body.bankAccountId || null;

  if (fundingMethod === 'bank') {
    if (!bankAccountId) throw httpError(400, 'bank_account_id is required when funding is bank');
    const bank = await prisma.bankAccount.findFirst({
      where: { id: bankAccountId, businessId: user.businessId }
    });
    if (!bank) throw httpError(400, 'Invalid bank_account_id');
    creditAccountId = bank.glAccountId;
    creditDesc = `Pay from ${bank.name}`;
  } else if (fundingMethod === 'cash') {
    if (bankAccountId) {
      const bank = await prisma.bankAccount.findFirst({
        where: { id: bankAccountId, businessId: user.businessId }
      });
      if (!bank) throw httpError(400, 'Invalid bank_account_id');
      creditAccountId = bank.glAccountId;
    } else {
      creditAccountId = map.cash || null;
    }
    creditDesc = 'Pay cash';
  } else if (fundingMethod === 'credit') {
    creditAccountId = map.asset_acquisition_payable || map.accounts_payable || null;
    creditDesc = 'CIP payable';
  } else if (fundingMethod === 'inventory') {
    creditAccountId = map.inventory || null;
    creditDesc = 'Reclass from inventory';
  } else if (fundingMethod === 'manual' || fundingMethod === 'equity') {
    creditAccountId = map.equity || map.asset_disposal_gain || null;
    creditDesc = 'Equity / manual CIP funding';
  }
  if (!creditAccountId) {
    throw httpError(400, `Credit GL account is not configured for funding method "${fundingMethod}"`);
  }

  const costId = shortId('cpc');
  const result = await prisma.$transaction(async (tx) => {
    const journal = await createJournal(
      user,
      {
        entry_date: costDate,
        memo: `CIP spend — ${project.projectNumber}`,
        source_type: 'asset_cip_spend',
        source_id: costId,
        idempotency_key: `asset_cip_spend:${costId}`,
        branch_id: project.branchId || undefined,
        post: true,
        lines: [
          {
            account_id: cipAccountId,
            debit: amount,
            description: body.description || `CIP ${project.name}`
          },
          {
            account_id: creditAccountId!,
            credit: amount,
            description: creditDesc
          }
        ]
      },
      tx
    );
    const journalEntryId = (journal as any).id as string;
    const cost = await tx.capitalProjectCost.create({
      data: {
        id: costId,
        businessId: user.businessId,
        projectId: id,
        fundingMethod,
        description: body.description || null,
        amount: toDec(amount),
        costDate,
        bankAccountId,
        journalEntryId,
        createdById: user.id
      }
    });
    const newTotal = roundMoney(Number(project.totalCost) + amount);
    const updated = await tx.capitalProject.update({
      where: { id },
      data: {
        totalCost: toDec(newTotal),
        status: project.status === 'draft' ? 'active' : project.status
      },
      include: projectInclude
    });
    await recordEvent({
      businessId: user.businessId,
      eventType: 'cip_spend',
      sourceType: 'CapitalProjectCost',
      sourceId: costId,
      amount,
      journalEntryId,
      summary: `CIP spend ${amount} on ${project.projectNumber}`,
      createdById: user.id,
      tx
    });
    return { updated, cost };
  });

  await writeAudit({
    user,
    action: 'create',
    module: 'assets',
    entityType: 'CapitalProjectCost',
    entityId: costId,
    summary: `Added CIP cost ${amount} to ${project.projectNumber}`
  });
  return serialize(result.updated);
}

export async function completeProject(user: AuthUser, id: string) {
  const existing = await prisma.capitalProject.findFirst({
    where: { id, businessId: user.businessId }
  });
  if (!existing) throw httpError(404, 'Capital project not found');
  if (!['active', 'draft'].includes(existing.status)) {
    throw httpError(400, 'Only active projects can be completed');
  }
  if (Number(existing.totalCost) <= 0) throw httpError(400, 'Project has no costs to complete');
  const updated = await prisma.capitalProject.update({
    where: { id },
    data: { status: 'completed', completedAt: new Date() },
    include: projectInclude
  });
  return serialize(updated);
}

export async function capitaliseProject(user: AuthUser, id: string, body: Record<string, any> = {}) {
  const project = await prisma.capitalProject.findFirst({
    where: { id, businessId: user.businessId },
    include: { category: true, costs: true }
  });
  if (!project) throw httpError(404, 'Capital project not found');
  if (!['completed', 'active'].includes(project.status)) {
    throw httpError(400, 'Project must be completed (or active) before capitalisation');
  }
  if (project.capitalisedAssetId) throw httpError(400, 'Project already capitalised');
  const total = roundMoney(Number(project.totalCost));
  if (!(total > 0)) throw httpError(400, 'Nothing to capitalise');

  const map = await getDefaultAccountMap(user.businessId);
  const cipAccountId = project.category?.cipAccountId || map.asset_cip || null;
  const costAccountId = project.category?.costAccountId || map.fixed_assets || null;
  if (!cipAccountId) throw httpError(400, 'asset_cip GL account is not configured');
  if (!costAccountId) throw httpError(400, 'fixed_assets GL account is not configured');

  const assetName = requireString(body.asset_name || body.assetName || project.name, 'asset_name');
  const availableForUseDate = new Date(
    body.available_for_use_date || body.availableForUseDate || new Date()
  );
  const today = new Date();
  const entryDate =
    availableForUseDate.getTime() > today.getTime() ? today : availableForUseDate;

  const assetId = shortId('fa');
  const code =
    (body.asset_code || body.assetCode || null) &&
    String(body.asset_code || body.assetCode).trim()
      ? String(body.asset_code || body.assetCode).trim()
      : `CIP-${project.projectNumber}`;

  const result = await prisma.$transaction(async (tx) => {
    const journal = await createJournal(
      user,
      {
        entry_date: entryDate,
        memo: `CIP capitalise — ${project.projectNumber} → ${assetName}`,
        source_type: 'asset_cip_xfer',
        source_id: `${project.id}:${assetId}`,
        idempotency_key: `asset_cip_xfer:${project.id}:${assetId}`,
        branch_id: project.branchId || undefined,
        post: true,
        lines: [
          {
            account_id: costAccountId,
            debit: total,
            description: `Capitalise CIP ${project.projectNumber}`
          },
          {
            account_id: cipAccountId,
            credit: total,
            description: `Clear CIP ${project.projectNumber}`
          }
        ]
      },
      tx
    );
    const journalEntryId = (journal as any).id as string;

    await tx.fixedAsset.create({
      data: {
        id: assetId,
        businessId: user.businessId,
        branchId: project.branchId,
        code,
        name: assetName,
        description: project.description,
        categoryId: project.categoryId,
        category: project.category?.name || 'equipment',
        acquisitionSource: 'cip',
        purchaseDate: availableForUseDate,
        capitalisationDate: availableForUseDate,
        availableForUseDate,
        depreciationStartDate: availableForUseDate,
        purchaseCost: toDec(total),
        salvageValue: toDec(roundMoney(Number(body.salvage_value ?? body.salvageValue ?? 0))),
        usefulLifeMonths:
          Number(
            body.useful_life_months ??
              body.usefulLifeMonths ??
              project.category?.defaultUsefulLifeMonths ??
              36
          ) || 36,
        depreciationMethod:
          body.depreciation_method ||
          body.depreciationMethod ||
          project.category?.defaultDepreciationMethod ||
          'straight_line',
        costAccountId,
        status: 'active',
        operationalStatus: 'in_use',
        financialStatus: 'capitalised',
        acquisitionJournalEntryId: journalEntryId,
        createdById: user.id
      }
    });

    const updated = await tx.capitalProject.update({
      where: { id },
      data: {
        status: 'capitalised',
        capitalisedAt: new Date(),
        capitalisedAssetId: assetId,
        journalEntryId
      },
      include: projectInclude
    });

    await recordEvent({
      businessId: user.businessId,
      assetId,
      eventType: 'cip_capitalise',
      sourceType: 'CapitalProject',
      sourceId: project.id,
      amount: total,
      journalEntryId,
      summary: `Capitalised CIP ${project.projectNumber} → ${code}`,
      createdById: user.id,
      tx
    });

    return updated;
  });

  await writeAudit({
    user,
    action: 'post',
    module: 'assets',
    entityType: 'CapitalProject',
    entityId: id,
    summary: `Capitalised CIP ${project.projectNumber}`
  });
  return serialize({ ...result, net_book_value: netBookValue({ purchaseCost: total, accumulatedDepreciation: 0, accumulatedImpairment: 0 }) });
}

export async function cancelProject(user: AuthUser, id: string) {
  const existing = await prisma.capitalProject.findFirst({
    where: { id, businessId: user.businessId }
  });
  if (!existing) throw httpError(404, 'Capital project not found');
  if (['capitalised', 'cancelled'].includes(existing.status)) {
    throw httpError(400, 'Cannot cancel this project');
  }
  if (Number(existing.totalCost) > 0) {
    throw httpError(400, 'Cancel only empty projects (or reverse CIP costs first)');
  }
  const updated = await prisma.capitalProject.update({
    where: { id },
    data: { status: 'cancelled' },
    include: projectInclude
  });
  return serialize(updated);
}
