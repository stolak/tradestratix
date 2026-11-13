import React, { useEffect, useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { api } from '../../utils/api';
import { alertError, alertSuccess } from '../../utils/alerts';

export function PeriodsTab() {
  const { can } = useAuth();
  const canLock = can('accounting.edit');
  const [periods, setPeriods] = useState<any[]>([]);

  const load = async () => {
    try {
      setPeriods(await api.accounting.periods());
    } catch (e: any) {
      await alertError('Periods', e.message);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const toggleLock = async (id: string, locked: boolean) => {
    try {
      await api.accounting.lockPeriod(id, locked);
      await alertSuccess(locked ? 'Period locked' : 'Period unlocked');
      await load();
    } catch (e: any) {
      await alertError('Period update failed', e.message);
    }
  };

  return (
    <div className="card-surface" style={{ padding: '0.5rem 0' }}>
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Period</th>
              <th>Year</th>
              <th>Start</th>
              <th>End</th>
              <th>Locked</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {periods.map((p) => (
              <tr key={p.id}>
                <td>{p.name}</td>
                <td>{p.financial_year?.name || '—'}</td>
                <td>{String(p.starts_on).slice(0, 10)}</td>
                <td>{String(p.ends_on).slice(0, 10)}</td>
                <td>{p.is_locked ? 'Yes' : 'No'}</td>
                <td>
                      {canLock ? (
                        <button
                          type="button"
                          className="btn btn-ghost"
                          onClick={() => void toggleLock(p.id, !p.is_locked)}
                        >
                          {p.is_locked ? 'Unlock' : 'Lock'}
                        </button>
                      ) : null}
                    </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
