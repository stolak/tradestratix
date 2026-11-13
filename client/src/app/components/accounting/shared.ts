export const ACCOUNT_TYPES = [
  { value: 'asset', label: 'Asset' },
  { value: 'liability', label: 'Liability' },
  { value: 'equity', label: 'Equity' },
  { value: 'revenue', label: 'Revenue' },
  { value: 'cogs', label: 'COGS' },
  { value: 'expense', label: 'Expense' }
] as const;

export type AccountTreeRow = any & { depth: number; childCount: number };

export function yearStartIsoDate() {
  const d = new Date();
  return `${d.getFullYear()}-01-01`;
}

export function todayIsoDate() {
  return new Date().toISOString().slice(0, 10);
}

export function money(n: number | undefined | null) {
  return Number(n ?? 0).toLocaleString();
}

export function roundMoneySafe(n: number) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/** Flatten accounts into a depth-first tree ordered by code. */
export function flattenAccountTree(accounts: any[]): AccountTreeRow[] {
  type Node = any & { children: Node[] };
  const byId = new Map<string, Node>();
  for (const a of accounts) {
    byId.set(a.id, { ...a, children: [] });
  }
  const roots: Node[] = [];
  for (const node of byId.values()) {
    if (node.parent_id && byId.has(node.parent_id)) {
      byId.get(node.parent_id)!.children.push(node);
    } else {
      roots.push(node);
    }
  }
  const sortNodes = (nodes: Node[]) => {
    nodes.sort((a, b) =>
      String(a.code).localeCompare(String(b.code), undefined, { numeric: true })
    );
    nodes.forEach((n) => sortNodes(n.children));
  };
  sortNodes(roots);

  const rows: AccountTreeRow[] = [];
  const walk = (nodes: Node[], depth: number) => {
    for (const n of nodes) {
      rows.push({ ...n, depth, childCount: n.children.length });
      walk(n.children, depth + 1);
    }
  };
  walk(roots, 0);
  return rows;
}

export function accountLabel(
  accounts: any[],
  accountId: string,
  lineAccount?: { code: string; name: string } | null
) {
  if (lineAccount?.code) return `${lineAccount.code} — ${lineAccount.name}`;
  const a = accounts.find((x) => x.id === accountId);
  return a ? `${a.code} — ${a.name}` : accountId;
}

export function toggleIdInSet(prev: Set<string>, id: string) {
  const next = new Set(prev);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
}
