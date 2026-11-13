import React from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import type { ConsolidatedReportNode } from '../../utils/accountReportTree';

type Props = {
  node: ConsolidatedReportNode;
  expandedIds: Set<string>;
  onToggle: (accountId: string) => void;
};

export function ReportNameCell({ node, expandedIds, onToggle }: Props) {
  if (node.is_direct) {
    return (
      <span
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 4,
          paddingLeft: node.depth * 14,
          fontStyle: 'italic',
          color: 'var(--ink-muted)'
        }}
        title="Amounts journaled directly to this parent ledger (not via children)"
      >
        {node.name}
      </span>
    );
  }

  return (
    <button
      type="button"
      disabled={!node.has_children}
      onClick={() => node.has_children && onToggle(node.account_id)}
      className="btn btn-ghost"
      style={{
        padding: '0.15rem 0.35rem',
        justifyContent: 'flex-start',
        paddingLeft: node.depth * 14,
        fontWeight: node.has_children ? 700 : 500,
        cursor: node.has_children ? 'pointer' : 'default'
      }}
      title={
        node.has_children
          ? expandedIds.has(node.account_id)
            ? 'Hide breakdown'
            : 'Show breakdown (direct + children)'
          : undefined
      }
    >
      {node.has_children ? (
        expandedIds.has(node.account_id) ? (
          <ChevronDown size={14} />
        ) : (
          <ChevronRight size={14} />
        )
      ) : (
        <span style={{ width: 14, display: 'inline-block' }} />
      )}
      <span>
        {node.code} — {node.name}
      </span>
      {node.has_children && !expandedIds.has(node.account_id) ? (
        <span style={{ marginLeft: 6, fontSize: '0.7rem', color: 'var(--ink-muted)' }}>total</span>
      ) : null}
    </button>
  );
}
