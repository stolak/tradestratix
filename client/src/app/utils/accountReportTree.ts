export type CoaAccount = {
  id: string;
  code: string;
  name: string;
  account_type: string;
  parent_id?: string | null;
};

export type ReportAmountRow = {
  account_id: string;
  code: string;
  name: string;
  account_type: string;
  debit: number;
  credit: number;
  balance?: number;
};

export type ConsolidatedReportNode = ReportAmountRow & {
  depth: number;
  has_children: boolean;
  own_debit: number;
  own_credit: number;
  children: ConsolidatedReportNode[];
  /** Synthetic line: amounts posted on the parent ledger itself (not via children). */
  is_direct?: boolean;
  /** Stable React key (parents vs direct vs children). */
  row_key: string;
};

function money(n: number) {
  return Math.round(n * 100) / 100;
}

function toFiniteNumber(v: unknown) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Roll child account balances into parents for reporting.
 * Parents show own + all descendants; children are nested for expand/collapse UI.
 */
export function buildConsolidatedReportTree(
  rows: ReportAmountRow[] | null | undefined,
  accounts: CoaAccount[]
): ConsolidatedReportNode[] {
  const flat = rows || [];
  if (flat.length === 0) return [];

  const amountById = new Map(flat.map((r) => [r.account_id, r]));
  const accountById = new Map(accounts.map((a) => [a.id, a]));

  const relevantIds = new Set<string>();
  for (const r of flat) {
    let id: string | null | undefined = r.account_id;
    while (id) {
      relevantIds.add(id);
      id = accountById.get(id)?.parent_id || null;
    }
  }

  type Draft = {
    account_id: string;
    code: string;
    name: string;
    account_type: string;
    own_debit: number;
    own_credit: number;
    parent_id: string | null;
    children: Draft[];
  };

  const drafts = new Map<string, Draft>();
  for (const id of relevantIds) {
    const coa = accountById.get(id);
    const amt = amountById.get(id);
    drafts.set(id, {
      account_id: id,
      code: coa?.code || amt?.code || id,
      name: coa?.name || amt?.name || id,
      account_type: coa?.account_type || amt?.account_type || 'asset',
      own_debit: toFiniteNumber(amt?.debit),
      own_credit: toFiniteNumber(amt?.credit),
      parent_id: coa?.parent_id || null,
      children: []
    });
  }

  const roots: Draft[] = [];
  for (const node of drafts.values()) {
    if (node.parent_id && drafts.has(node.parent_id)) {
      drafts.get(node.parent_id)!.children.push(node);
    } else {
      roots.push(node);
    }
  }

  const sortDrafts = (nodes: Draft[]) => {
    nodes.sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true }));
    nodes.forEach((n) => sortDrafts(n.children));
  };
  sortDrafts(roots);

  const toNode = (draft: Draft, depth: number): ConsolidatedReportNode => {
    const children = draft.children.map((c) => toNode(c, depth + 1));
    const debit = money(draft.own_debit + children.reduce((s, c) => s + c.debit, 0));
    const credit = money(draft.own_credit + children.reduce((s, c) => s + c.credit, 0));
    return {
      account_id: draft.account_id,
      row_key: draft.account_id,
      code: draft.code,
      name: draft.name,
      account_type: draft.account_type,
      own_debit: draft.own_debit,
      own_credit: draft.own_credit,
      debit,
      credit,
      balance: money(debit - credit),
      depth,
      has_children: children.length > 0,
      children
    };
  };

  return roots.map((r) => toNode(r, 0));
}

function hasOwnActivity(n: ConsolidatedReportNode) {
  return n.own_debit !== 0 || n.own_credit !== 0;
}

function directActivityRow(parent: ConsolidatedReportNode): ConsolidatedReportNode {
  const debit = parent.own_debit;
  const credit = parent.own_credit;
  return {
    account_id: parent.account_id,
    row_key: `${parent.account_id}__direct`,
    code: parent.code,
    name: `Direct on ${parent.code} — ${parent.name}`,
    account_type: parent.account_type,
    own_debit: debit,
    own_credit: credit,
    debit,
    credit,
    balance: money(debit - credit),
    depth: parent.depth + 1,
    has_children: false,
    children: [],
    is_direct: true
  };
}

export function flattenExpandedReportTree(
  roots: ConsolidatedReportNode[],
  expandedIds: Set<string>
): ConsolidatedReportNode[] {
  const out: ConsolidatedReportNode[] = [];
  const walk = (nodes: ConsolidatedReportNode[]) => {
    for (const n of nodes) {
      out.push(n);
      if (n.has_children && expandedIds.has(n.account_id)) {
        if (hasOwnActivity(n)) {
          out.push(directActivityRow(n));
        }
        walk(n.children);
      }
    }
  };
  walk(roots);
  return out;
}
