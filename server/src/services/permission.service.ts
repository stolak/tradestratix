import { prisma } from '../utils/prisma.js';
import { serialize } from '../utils/helpers.js';

export async function getUserPermissionCodes(userId: string): Promise<string[]> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: {
      userRoles: {
        include: {
          role: {
            include: { rolePermissions: { include: { permission: true } } }
          }
        }
      },
      permissionOverrides: { include: { permission: true } }
    }
  });
  if (!user) return [];
  if (user.role === 'business_owner') {
    const all = await prisma.permission.findMany({ where: { isActive: true }, select: { code: true } });
    return all.map((p) => p.code);
  }

  const granted = new Set<string>();
  const denied = new Set<string>();

  for (const ur of user.userRoles) {
    for (const rp of ur.role.rolePermissions) {
      if (rp.permission.isActive) granted.add(rp.permission.code);
    }
  }
  for (const ov of user.permissionOverrides) {
    if (ov.effect === 'deny') denied.add(ov.permission.code);
    if (ov.effect === 'grant') granted.add(ov.permission.code);
  }
  for (const d of denied) granted.delete(d);
  return [...granted];
}

export async function userHasAnyPermission(userId: string, codes: string[]): Promise<boolean> {
  if (!codes.length) return true;
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { role: true } });
  if (user?.role === 'business_owner') return true;
  const have = await getUserPermissionCodes(userId);
  return codes.some((c) => have.includes(c));
}

export async function listPermissions() {
  const rows = await prisma.permission.findMany({ orderBy: [{ module: 'asc' }, { sortOrder: 'asc' }] });
  return serialize(rows);
}

export async function listRoles(businessId: string) {
  const rows = await prisma.role.findMany({
    where: { OR: [{ businessId }, { businessId: null }] },
    include: {
      rolePermissions: { include: { permission: true } },
      roleMenus: { include: { menu: true } }
    },
    orderBy: { sortOrder: 'asc' }
  });
  return serialize(rows);
}

export async function getUserMenus(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: {
      userRoles: {
        include: { role: { include: { roleMenus: { include: { menu: true } } } } }
      }
    }
  });
  if (!user) return [];
  if (user.role === 'business_owner') {
    const menus = await prisma.menu.findMany({
      where: { isActive: true, OR: [{ businessId: user.businessId }, { businessId: null }] },
      orderBy: { sortOrder: 'asc' }
    });
    return serialize(menus);
  }
  const map = new Map<string, unknown>();
  for (const ur of user.userRoles) {
    for (const rm of ur.role.roleMenus) {
      if (rm.menu.isActive) map.set(rm.menu.id, rm.menu);
    }
  }
  return serialize([...map.values()].sort((a: any, b: any) => a.sortOrder - b.sortOrder));
}
