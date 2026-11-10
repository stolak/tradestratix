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
    summary: 'Updated business profile'
  });
  return serialize(updated);
}

export async function upsertSetting(user: AuthUser, key: string, value: string) {
  const existing = await prisma.businessSetting.findUnique({
    where: { businessId_settingKey: { businessId: user.businessId, settingKey: key } }
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
          settingKey: key,
          value,
          updatedBy: user.id
        }
      });
  return serialize(row);
}
