import { prisma } from '../utils/prisma.js';
import { httpError, requireString, serialize, shortId } from '../utils/helpers.js';
import type { AuthUser } from '../types/express/index.js';
import { writeAudit } from './audit.service.js';

export async function getCurrentBusiness(businessId: string) {
  const biz = await prisma.business.findUnique({
    where: { id: businessId },
    include: {
      currencies: true,
      settings: true,
      subscriptions: { include: { plan: true }, orderBy: { createdAt: 'desc' }, take: 1 }
    }
  });
  if (!biz) throw httpError(404, 'Business not found');
  return serialize(biz);
}

export async function updateCurrentBusiness(
  user: AuthUser,
  body: Record<string, unknown>
) {
  const data: Record<string, unknown> = {};
  const fields = [
    'name',
    'legalName',
    'registrationNumber',
    'taxId',
    'email',
    'phone',
    'addressLine1',
    'addressLine2',
    'city',
    'state',
    'country',
    'postalCode',
    'logoUrl',
    'businessType',
    'defaultCurrency',
    'inventoryValuation',
    'timezone',
    'fiscalYearStartMonth',
    'enabledModulesJson'
  ] as const;

  for (const f of fields) {
    const snake = f.replace(/[A-Z]/g, (m) => `_${m.toLowerCase()}`);
    if (body[f] !== undefined) data[f] = body[f];
    else if (body[snake] !== undefined) data[f] = body[snake];
  }
  if (body.name != null) data.name = requireString(body.name, 'name');

  const existing = await prisma.business.findUnique({ where: { id: user.businessId } });
  if (!existing) throw httpError(404, 'Business not found');

  const updated = await prisma.business.update({
    where: { id: user.businessId },
    data: { ...data, updatedById: user.id } as any
  });
  await writeAudit({
    user,
    action: 'update',
    module: 'businesses',
    entityType: 'Business',
    entityId: updated.id,
    summary: 'Updated business profile',
    before: existing as unknown as Record<string, unknown>,
    after: updated as unknown as Record<string, unknown>
  });
  return serialize(updated);
}

export const VAT_RATE_SETTING_KEY = 'vat_rate_percent';
export const DEFAULT_VAT_RATE_PERCENT = 7.5;

export async function getSettingValue(
  businessId: string,
  key: string
): Promise<string | null> {
  const row = await prisma.businessSetting.findUnique({
    where: { businessId_settingKey: { businessId, settingKey: key } }
  });
  return row?.value ?? null;
}

/** Nigeria default output VAT % for the business (falls back to 7.5). */
export async function getDefaultVatRatePercent(businessId: string): Promise<number> {
  const raw = await getSettingValue(businessId, VAT_RATE_SETTING_KEY);
  if (raw == null || raw === '') return DEFAULT_VAT_RATE_PERCENT;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return DEFAULT_VAT_RATE_PERCENT;
  return n;
}

export async function upsertSetting(user: AuthUser, key: string, value: string) {
  const settingKey = requireString(key, 'key').trim();
  if (settingKey === VAT_RATE_SETTING_KEY) {
    const n = Number(value);
    if (!Number.isFinite(n) || n < 0 || n > 100) {
      throw httpError(400, 'vat_rate_percent must be a number between 0 and 100');
    }
    value = String(n);
  }

  const existing = await prisma.businessSetting.findUnique({
    where: { businessId_settingKey: { businessId: user.businessId, settingKey } }
  });
  const row = existing
    ? await prisma.businessSetting.update({
        where: { id: existing.id },
        data: { value, updatedBy: user.id }
      })
    : await prisma.businessSetting.create({
        data: {
          id: shortId('bst'),
          businessId: user.businessId,
          settingKey,
          value,
          updatedBy: user.id
        }
      });

  await writeAudit({
    user,
    action: existing ? 'update' : 'create',
    module: 'settings',
    entityType: 'BusinessSetting',
    entityId: row.id,
    summary: `Set ${settingKey}=${value}`
  });

  return serialize(row);
}
