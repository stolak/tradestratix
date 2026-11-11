import React, { useEffect, useState } from 'react';
import { api } from '../utils/api';
import { alertError, alertSuccess } from '../utils/alerts';

type Tab = 'register' | 'depreciate' | 'budgets';

export const AssetsPage: React.FC = () => {
  const [tab, setTab] = useState<Tab>('register');
  const [assets, setAssets] = useState<any[]>([]);
  const [deps, setDeps] = useState<any[]>([]);
  const [budgets, setBudgets] = useState<any[]>([]);
  const [glAccounts, setGlAccounts] = useState<any[]>([]);
  const [vsActual, setVsActual] = useState<any | null>(null);
  const [assetForm, setAssetForm] = useState({
    name: '',
    category: 'equipment',
    purchase_date: new Date().toISOString().slice(0, 10),
    purchase_cost: '',
    salvage_value: '0',
    useful_life_months: '36',
    pay_method: 'bank'
  });
  const [budgetForm, setBudgetForm] = useState({
    name: '',
    fiscal_year: String(new Date().getFullYear()),
    account_id: '',
    amount: ''
  });

  const load = async () => {
    try {
      const [a, d, b, gl] = await Promise.all([
        api.assets.list(),
        api.assets.depreciationEntries(),
        api.budgets.list(),
        api.accounting.accounts()
      ]);
      setAssets(a);
      setDeps(d);
      setBudgets(b);
      setGlAccounts(gl.filter((x: any) => x.is_active !== false));
      const expense =
        gl.find((x: any) => x.code === '6400') || gl.find((x: any) => x.account_type === 'expense');
      setBudgetForm((f) => ({ ...f, account_id: f.account_id || expense?.id || '' }));
    } catch (e: any) {
      await alertError('Assets', e.message);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const createAsset = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await api.assets.create({
        ...assetForm,
        purchase_cost: Number(assetForm.purchase_cost),
        salvage_value: Number(assetForm.salvage_value),
        useful_life_months: Number(assetForm.useful_life_months)
      });
      await alertSuccess('Asset created');
      setAssetForm((f) => ({ ...f, name: '', purchase_cost: '' }));
      await load();
    } catch (err: any) {
      await alertError('Create failed', err.message);
    }
  };

  const runDep = async () => {
    try {
      const res = await api.assets.runDepreciation({});
      await alertSuccess(`Depreciation posted (${res.count || 0} entries)`);
      await load();
      setTab('depreciate');
    } catch (err: any) {
      await alertError('Depreciation failed', err.message);
    }
  };

  const createBudget = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await api.budgets.create({
        name: budgetForm.name,
        fiscal_year: Number(budgetForm.fiscal_year),
        lines: [{ account_id: budgetForm.account_id, period_no: 0, amount: Number(budgetForm.amount) }]
      });
      await alertSuccess('Budget created');
      setBudgetForm((f) => ({ ...f, name: '', amount: '' }));
      await load();
    } catch (err: any) {
      await alertError('Budget failed', err.message);
    }
  };

  const activate = async (id: string) => {
    try {
      await api.budgets.activate(id);
      await alertSuccess('Budget activated');
      await load();
    } catch (err: any) {
      await alertError('Activate failed', err.message);
    }
  };

  const showVs = async (id: string) => {
    try {
      setVsActual(await api.budgets.vsActual(id));
    } catch (err: any) {
      await alertError('Vs actual failed', err.message);
    }
  };

  return (
    <div className="page-stack">
      <header>
        <h1 className="display" style={{ margin: 0, fontSize: '2.2rem' }}>
          Assets
        </h1>
        <p style={{ color: 'var(--ink-muted)', margin: '0.35rem 0 0' }}>
          Fixed assets, straight-line depreciation, and budgets.
        </p>
      </header>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {(
          [
            ['register', 'Register'],
            ['depreciate', 'Depreciate'],
            ['budgets', 'Budgets']
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            className={tab === key ? 'btn btn-primary' : 'btn btn-ghost'}
            onClick={() => setTab(key)}
          >
            {label}
          </button>
        ))}
        <button type="button" className="btn btn-ghost" onClick={() => void load()}>
          Refresh
        </button>
      </div>

      {tab === 'register' ? (
        <>
          <form onSubmit={createAsset} className="card-surface" style={{ padding: '1.25rem', display: 'grid', gap: 12 }}>
            <div style={{ fontWeight: 700 }}>Register asset</div>
            <div className="form-grid">
              <div className="field">
                <label>Name</label>
                <input value={assetForm.name} onChange={(e) => setAssetForm({ ...assetForm, name: e.target.value })} required />
              </div>
              <div className="field">
                <label>Category</label>
                <input value={assetForm.category} onChange={(e) => setAssetForm({ ...assetForm, category: e.target.value })} />
              </div>
              <div className="field">
                <label>Purchase date</label>
                <input type="date" value={assetForm.purchase_date} onChange={(e) => setAssetForm({ ...assetForm, purchase_date: e.target.value })} />
              </div>
              <div className="field">
                <label>Cost</label>
                <input type="number" min="0" step="0.01" value={assetForm.purchase_cost} onChange={(e) => setAssetForm({ ...assetForm, purchase_cost: e.target.value })} required />
              </div>
              <div className="field">
                <label>Salvage</label>
                <input type="number" min="0" step="0.01" value={assetForm.salvage_value} onChange={(e) => setAssetForm({ ...assetForm, salvage_value: e.target.value })} />
              </div>
              <div className="field">
                <label>Life (months)</label>
                <input type="number" min="1" value={assetForm.useful_life_months} onChange={(e) => setAssetForm({ ...assetForm, useful_life_months: e.target.value })} />
              </div>
              <div className="field">
                <label>Fund with</label>
                <select value={assetForm.pay_method} onChange={(e) => setAssetForm({ ...assetForm, pay_method: e.target.value })}>
                  <option value="bank">Bank</option>
                  <option value="cash">Cash</option>
                  <option value="equity">Equity</option>
                </select>
              </div>
              <div className="form-grid--actions">
                <button className="btn btn-primary" type="submit">
                  Create &amp; post acquisition
                </button>
              </div>
            </div>
          </form>

          <div className="card-surface" style={{ padding: '0.5rem 0' }}>
            <div className="table-wrap">
              <table className="table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Category</th>
                  <th>Cost</th>
                  <th>Accum. dep.</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {assets.map((a) => (
                  <tr key={a.id}>
                    <td>{a.name}</td>
                    <td>{a.category}</td>
                    <td>{Number(a.purchase_cost).toLocaleString()}</td>
                    <td>{Number(a.accumulated_depreciation).toLocaleString()}</td>
                    <td>{a.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          </div>
        </>
      ) : null}

      {tab === 'depreciate' ? (
        <>
          <div className="card-surface" style={{ padding: '1.25rem', display: 'flex', gap: 12, alignItems: 'center' }}>
            <button type="button" className="btn btn-primary" onClick={() => void runDep()}>
              Run this month&apos;s depreciation
            </button>
            <span style={{ color: 'var(--ink-muted)', fontSize: 14 }}>
              Posts Dr depreciation expense / Cr accumulated depreciation for each active asset.
            </span>
          </div>
          <div className="card-surface" style={{ padding: '0.5rem 0' }}>
            <div className="table-wrap">
              <table className="table">
              <thead>
                <tr>
                  <th>Period</th>
                  <th>Asset</th>
                  <th>Amount</th>
                  <th>Date</th>
                </tr>
              </thead>
              <tbody>
                {deps.map((d) => (
                  <tr key={d.id}>
                    <td>{d.period_label}</td>
                    <td>{d.asset?.name}</td>
                    <td>{Number(d.amount).toLocaleString()}</td>
                    <td>{d.run_date?.slice?.(0, 10) || d.created_at?.slice?.(0, 10)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          </div>
        </>
      ) : null}

      {tab === 'budgets' ? (
        <>
          <form onSubmit={createBudget} className="card-surface" style={{ padding: '1.25rem', display: 'grid', gap: 12 }}>
            <div style={{ fontWeight: 700 }}>New budget (annual line)</div>
            <div className="form-grid">
              <div className="field">
                <label>Name</label>
                <input value={budgetForm.name} onChange={(e) => setBudgetForm({ ...budgetForm, name: e.target.value })} required />
              </div>
              <div className="field">
                <label>Year</label>
                <input value={budgetForm.fiscal_year} onChange={(e) => setBudgetForm({ ...budgetForm, fiscal_year: e.target.value })} required />
              </div>
              <div className="field">
                <label>Account</label>
                <select value={budgetForm.account_id} onChange={(e) => setBudgetForm({ ...budgetForm, account_id: e.target.value })} required>
                  {glAccounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.code} — {a.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label>Amount</label>
                <input type="number" min="0" value={budgetForm.amount} onChange={(e) => setBudgetForm({ ...budgetForm, amount: e.target.value })} required />
              </div>
              <div className="form-grid--actions">
                <button className="btn btn-primary" type="submit">
                  Create budget
                </button>
              </div>
            </div>
          </form>

          <div className="card-surface" style={{ padding: '0.5rem 0' }}>
            <div className="table-wrap">
              <table className="table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Year</th>
                  <th>Status</th>
                  <th>Lines</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {budgets.map((b) => (
                  <tr key={b.id}>
                    <td>{b.name}</td>
                    <td>{b.fiscal_year}</td>
                    <td>{b.status}</td>
                    <td>{b._count?.lines ?? b.lines?.length ?? 0}</td>
                    <td style={{ display: 'flex', gap: 6 }}>
                      {b.status === 'draft' ? (
                        <button type="button" className="btn btn-ghost" onClick={() => void activate(b.id)}>
                          Activate
                        </button>
                      ) : null}
                      <button type="button" className="btn btn-ghost" onClick={() => void showVs(b.id)}>
                        Vs actual
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          </div>

          {vsActual ? (
            <div className="card-surface" style={{ padding: '1rem' }}>
              <div style={{ fontWeight: 700, marginBottom: 8 }}>
                {vsActual.budget?.name} — budget vs actual
              </div>
              <div className="table-wrap">
                <table className="table">
                <thead>
                  <tr>
                    <th>Account</th>
                    <th>Budget</th>
                    <th>Actual</th>
                    <th>Variance</th>
                  </tr>
                </thead>
                <tbody>
                  {(vsActual.lines || []).map((l: any, i: number) => (
                    <tr key={i}>
                      <td>
                        {l.account?.code} {l.account?.name}
                      </td>
                      <td>{Number(l.budget).toLocaleString()}</td>
                      <td>{Number(l.actual).toLocaleString()}</td>
                      <td>{Number(l.variance).toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
                </table>
              </div>
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  );
};
