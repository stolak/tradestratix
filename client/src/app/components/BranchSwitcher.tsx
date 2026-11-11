import React from 'react';
import { useAuth } from '../context/AuthContext';

export const BranchSwitcher: React.FC = () => {
  const { branches, activeBranchId, switchBranch, loadingBranch } = useAuth();

  if (!branches.length) {
    return (
      <div style={{ fontSize: '0.85rem', color: 'var(--ink-muted)' }}>No branch access</div>
    );
  }

  if (branches.length === 1) {
    const b = branches[0];
    return (
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '0.35rem 0.75rem',
          borderRadius: 8,
          background: 'var(--surface-2, rgba(0,0,0,0.04))',
          fontSize: '0.85rem',
          minWidth: 0
        }}
        title="Active branch"
      >
        <span style={{ opacity: 0.65 }}>Branch</span>
        <strong style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {b.name} ({b.code})
        </strong>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
      <label htmlFor="branch-switcher" style={{ fontSize: '0.8rem', color: 'var(--ink-muted)' }}>
        Branch
      </label>
      <select
        id="branch-switcher"
        value={activeBranchId || ''}
        disabled={loadingBranch}
        onChange={(e) => {
          void switchBranch(e.target.value);
        }}
        style={{
          width: 'min(220px, 100%)',
          maxWidth: '100%',
          minWidth: 0,
          borderRadius: 8,
          border: '1px solid var(--border, #d0d5dd)',
          padding: '0.4rem 0.6rem',
          background: 'white',
          fontWeight: 600
        }}
      >
        {branches.map((b) => (
          <option key={b.id} value={b.id} disabled={b.is_active === false}>
            {b.name} ({b.code}){b.is_active === false ? ' — inactive' : ''}
          </option>
        ))}
      </select>
    </div>
  );
};
