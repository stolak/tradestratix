import { prisma } from '../utils/prisma.js';
import { httpError, serialize } from '../utils/helpers.js';
import type { AuthUser } from '../types/express/index.js';
import { writeAudit } from './audit.service.js';

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
  const rows = await prisma.permission.findMany({
    where: { isActive: true },
    orderBy: [{ module: 'asc' }, { sortOrder: 'asc' }]
  });
  return serialize(rows);
}

export async function listMenus(businessId: string) {
  const rows = await prisma.menu.findMany({
    where: {
      isActive: true,
      OR: [{ businessId }, { businessId: null }]
    },
    orderBy: [{ section: 'asc' }, { sortOrder: 'asc' }]
  });
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

export async function getRole(businessId: string, roleId: string) {
  const role = await prisma.role.findFirst({
    where: {
      id: roleId,
      OR: [{ businessId }, { businessId: null }]
    },
    include: {
      rolePermissions: { include: { permission: true } },
      roleMenus: { include: { menu: true } }
    }
  });
  if (!role) throw httpError(404, 'Role not found');
  return serialize(role);
}

export async function updateRoleAccess(
  actor: AuthUser,
  roleId: string,
  body: Record<string, any>
) {
  const role = await prisma.role.findFirst({
    where: {
      id: roleId,
      OR: [{ businessId: actor.businessId }, { businessId: null }]
    }
  });
  if (!role) throw httpError(404, 'Role not found');

  const rawPermissionIds = body.permission_ids ?? body.permissionIds;
  const rawMenuIds = body.menu_ids ?? body.menuIds;
  const permissionIds: string[] | null = Array.isArray(rawPermissionIds)
    ? [...new Set(rawPermissionIds.map((v) => String(v)).filter((v): v is string => Boolean(v)))]
    : null;
  const menuIds: string[] | null = Array.isArray(rawMenuIds)
    ? [...new Set(rawMenuIds.map((v) => String(v)).filter((v): v is string => Boolean(v)))]
    : null;

  if (permissionIds) {
    if (permissionIds.length) {
      const count = await prisma.permission.count({
        where: { id: { in: permissionIds }, isActive: true }
      });
      if (count !== permissionIds.length) {
        throw httpError(400, 'One or more permission_ids are invalid');
      }
    }
    await prisma.$transaction(async (tx) => {
      await tx.rolePermission.deleteMany({ where: { roleId } });
      if (permissionIds.length) {
        await tx.rolePermission.createMany({
          data: permissionIds.map((permissionId) => ({ roleId, permissionId }))
        });
      }
    });
  }

  if (menuIds) {
    if (menuIds.length) {
      const count = await prisma.menu.count({
        where: {
          id: { in: menuIds },
          isActive: true,
          OR: [{ businessId: actor.businessId }, { businessId: null }]
        }
      });
      if (count !== menuIds.length) {
        throw httpError(400, 'One or more menu_ids are invalid');
      }
    }
    await prisma.$transaction(async (tx) => {
      await tx.roleMenu.deleteMany({ where: { roleId } });
      if (menuIds.length) {
        await tx.roleMenu.createMany({
          data: menuIds.map((menuId) => ({ roleId, menuId }))
        });
      }
    });
  }

  await writeAudit({
    user: actor,
    action: 'update_access',
    module: 'roles',
    entityType: 'Role',
    entityId: roleId,
    summary: `Updated access for role ${role.code}`
  });

  return getRole(actor.businessId, roleId);
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
