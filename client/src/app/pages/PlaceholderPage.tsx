import React from 'react';

export const PlaceholderPage: React.FC<{ title: string; phase: string }> = ({ title, phase }) => (
  <div className="card-surface" style={{ padding: '2rem' }}>
    <h1 className="display" style={{ marginTop: 0, fontSize: '2.2rem' }}>
      {title}
    </h1>
    <p style={{ color: 'var(--ink-muted)', maxWidth: 560 }}>
      This module is designed into the ERP roadmap and will be implemented in {phase}. Navigation is
      visible for planning; backend APIs for this domain are not enabled yet.
    </p>
  </div>
);
