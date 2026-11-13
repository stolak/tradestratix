import React from 'react';

type Props = {
  asAtDate: string;
  onAsAtChange: (value: string) => void;
  loading?: boolean;
  onRun: () => void;
};

export function AsAtToolbar({ asAtDate, onAsAtChange, loading, onRun }: Props) {
  return (
    <div
      style={{
        padding: '0.75rem 1rem',
        display: 'flex',
        flexWrap: 'wrap',
        gap: 12,
        alignItems: 'end',
        justifyContent: 'space-between'
      }}
    >
      <div style={{ color: 'var(--ink-muted)', fontSize: '0.85rem' }}>
        Parent totals = direct postings on the parent + all children. Expand a parent to see each
        part.
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'end' }}>
        <div className="field" style={{ margin: 0 }}>
          <label>As at</label>
          <input type="date" value={asAtDate} onChange={(e) => onAsAtChange(e.target.value)} />
        </div>
        <button type="button" className="btn btn-primary" disabled={loading} onClick={onRun}>
          {loading ? 'Running…' : 'Run report'}
        </button>
      </div>
    </div>
  );
}
