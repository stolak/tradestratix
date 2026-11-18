import React, { useEffect, useState } from 'react';
import { api } from '../utils/api';
import { alertError, alertSuccess } from '../utils/alerts';

type Tab = 'register' | 'categories' | 'locations' | 'depreciate' | 'budgets';

export const AssetsPage: React.FC = () => {
  const [tab, setTab] = useState<Tab>('register');
  const [assets, setAssets] = useState<any[]>([]);
  const [acquisitions, setAcquisitions] = useState<any[]>([]);
  const [categories, setCategories] = useState<any[]>([]);
  const [locations, setLocations] = useState<any[]>([]);
  const [deps, setDeps] = useState<any[]>([]);
  const [depRuns, setDepRuns] = useState<any[]>([]);
  const [selectedRun, setSelectedRun] = useState<any | null>(null);
  const [depPeriod, setDepPeriod] = useState(
    `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}`
  );
  const [budgets, setBudgets] = useState<any[]>([]);
  const [glAccounts, setGlAccounts] = useState<any[]>([]);
  const [bankAccounts, setBankAccounts] = useState<any[]>([]);
  const [suppliers, setSuppliers] = useState<any[]>([]);
  const [vsActual, setVsActual] = useState<any | null>(null);

  const FUNDING_BY_SOURCE: Record<string, { value: string; label: string }[]> = {
    direct: [
      { value: 'bank', label: 'Bank' },
      { value: 'cash', label: 'Cash' },
      { value: 'credit', label: 'Credit / payable' }
    ],
    opening_balance: [{ value: 'opening', label: 'Opening equity' }],
    donation: [
      { value: 'donation', label: 'Donation / capital contribution' },
      { value: 'equity', label: 'Equity' }
    ],
    other: [
      { value: 'bank', label: 'Bank' },
      { value: 'cash', label: 'Cash' },
      { value: 'credit', label: 'Credit / payable' },
      { value: 'equity', label: 'Equity' }
    ]
  };
  const [nameFilter, setNameFilter] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [selectedId, setSelectedId] = useState('');
  const [editForm, setEditForm] = useState({
    department: '',
    condition: 'good',
    location_id: '',
    notes: ''
  });
  const [acqForm, setAcqForm] = useState({
    asset_name: '',
    manufacturer: '',
    model: '',
    category_id: '',
    location_id: '',
    acquisition_date: new Date().toISOString().slice(0, 10),
    quantity: '1',
    unit_cost: '',
    salvage_value: '0',
    useful_life_months: '36',
    source: 'direct',
    funding_method: 'bank',
    bank_account_id: '',
    supplier_id: '',
    serial_numbers_text: '',
    notes: ''
  });
  const [selectedCategoryId, setSelectedCategoryId] = useState('');
  const emptyCategoryForm = {
    code: '',
    name: '',
    default_useful_life_months: '36',
    default_depreciation_method: 'straight_line',
    capitalisation_threshold: '0',
    cost_account_id: '',
    accum_dep_account_id: '',
    dep_expense_account_id: '',
    is_active: true
  };
  const [categoryForm, setCategoryForm] = useState(emptyCategoryForm);
  const [locationForm, setLocationForm] = useState({ code: '', name: '', description: '' });
  const [budgetForm, setBudgetForm] = useState({
    name: '',
    fiscal_year: String(new Date().getFullYear()),
    asset_category_id: '',
    amount: ''
  });

  const load = async () => {
    try {
      const [a, acqs, cats, locs, d, runs, b, gl, banks, sups] = await Promise.all([
        api.assets.list({
          q: nameFilter || undefined,
          category_id: categoryFilter || undefined
        }),
        api.assets.acquisitions().catch(() => []),
        api.assets.categories().catch(() => []),
        api.assets.locations().catch(() => []),
        api.assets.depreciationEntries(),
        api.assets.depreciationRuns().catch(() => []),
        api.budgets.list(),
        api.accounting.accounts(),
        api.banking.accounts().catch(() => []),
        api.suppliers.list().catch(() => [])
      ]);
      setAssets(a);
      setAcquisitions(acqs);
      setCategories(cats);
      setDepRuns(Array.isArray(runs) ? runs : []);
      setLocations(locs);
      setDeps(d);
      setBudgets(b);
      const activeBanks = (banks || []).filter((x: any) => x.is_active !== false);
      setBankAccounts(activeBanks);
      setSuppliers(sups || []);
      const activeGl = gl.filter((x: any) => x.is_active !== false);
      setGlAccounts(activeGl);
      const expense =
        activeGl.find((x: any) => x.code === '6400') ||
        activeGl.find((x: any) => x.account_type === 'expense');
      const fa =
        activeGl.find((x: any) => x.code === '1200') ||
        activeGl.find((x: any) => x.account_type === 'asset');
      const accum =
        activeGl.find((x: any) => /accum/i.test(x.name) && x.account_type === 'asset') || fa;
      setCategoryForm((f) => ({
        ...f,
        cost_account_id: f.cost_account_id || fa?.id || '',
        accum_dep_account_id: f.accum_dep_account_id || accum?.id || '',
        dep_expense_account_id: f.dep_expense_account_id || expense?.id || ''
      }));
      setAcqForm((f) => ({
        ...f,
        category_id: f.category_id || cats[0]?.id || '',
        bank_account_id: f.bank_account_id || activeBanks[0]?.id || '',
        supplier_id: f.supplier_id || (sups || [])[0]?.id || ''
      }));
    } catch (e: any) {
      await alertError('Assets', e.message);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const createAcquisition = async (e: React.FormEvent) => {
    e.preventDefault();
    const quantity = Math.max(1, Math.floor(Number(acqForm.quantity) || 1));
    try {
      await api.assets.createAcquisition({
        asset_name: acqForm.asset_name,
        manufacturer: acqForm.manufacturer || undefined,
        model: acqForm.model || acqForm.asset_name,
        category_id: acqForm.category_id || undefined,
        location_id: acqForm.location_id || undefined,
        acquisition_date: acqForm.acquisition_date,
        quantity,
        unit_cost: Number(acqForm.unit_cost),
        salvage_value: Number(acqForm.salvage_value),
        useful_life_months: Number(acqForm.useful_life_months),
        source: acqForm.source,
        funding_method: acqForm.funding_method,
        bank_account_id:
          acqForm.funding_method === 'bank' || acqForm.funding_method === 'cash'
            ? acqForm.bank_account_id || undefined
            : undefined,
        supplier_id:
          acqForm.funding_method === 'credit' ? acqForm.supplier_id || undefined : undefined,
        serial_numbers_text: acqForm.serial_numbers_text || undefined,
        notes: acqForm.notes || undefined
      });
      await alertSuccess(
        quantity > 1 ? `Draft created for ${quantity} units` : 'Acquisition draft created'
      );
      setAcqForm((f) => ({
        ...f,
        asset_name: '',
        manufacturer: '',
        model: '',
        unit_cost: '',
        serial_numbers_text: '',
        notes: '',
        quantity: '1'
      }));
      await load();
    } catch (err: any) {
      await alertError('Acquisition failed', err.message);
    }
  };

  const acqQty = Math.max(1, Math.floor(Number(acqForm.quantity) || 1));
  const acqUnit = Number(acqForm.unit_cost) || 0;
  const acqLotTotal = acqUnit * acqQty;
  const serialLineCount = acqForm.serial_numbers_text
    .split(/[\n,;]+/)
    .map((s) => s.trim())
    .filter(Boolean).length;
  const fundingOptions = FUNDING_BY_SOURCE[acqForm.source] || FUNDING_BY_SOURCE.direct;

  const onAcqSourceChange = (source: string) => {
    const options = FUNDING_BY_SOURCE[source] || FUNDING_BY_SOURCE.direct;
    const fundingStillValid = options.some((o) => o.value === acqForm.funding_method);
    setAcqForm({
      ...acqForm,
      source,
      funding_method: fundingStillValid ? acqForm.funding_method : options[0].value
    });
  };

  const runAcqAction = async (
    id: string,
    action: 'submit' | 'approve' | 'capitalise' | 'cancel'
  ) => {
    try {
      if (action === 'submit') await api.assets.submitAcquisition(id);
      else if (action === 'approve') await api.assets.approveAcquisition(id);
      else if (action === 'capitalise') await api.assets.capitaliseAcquisition(id);
      else await api.assets.cancelAcquisition(id);
      const done =
        action === 'submit'
          ? 'submitted'
          : action === 'approve'
            ? 'approved'
            : action === 'capitalise'
              ? 'capitalised'
              : 'cancelled';
      await alertSuccess(`Acquisition ${done}`);
      await load();
    } catch (err: any) {
      await alertError(`Acquisition ${action} failed`, err.message);
    }
  };

  const resetCategoryForm = (defaults?: Partial<typeof emptyCategoryForm>) => {
    setSelectedCategoryId('');
    setCategoryForm({
      ...emptyCategoryForm,
      cost_account_id: defaults?.cost_account_id || categoryForm.cost_account_id || '',
      accum_dep_account_id: defaults?.accum_dep_account_id || categoryForm.accum_dep_account_id || '',
      dep_expense_account_id:
        defaults?.dep_expense_account_id || categoryForm.dep_expense_account_id || ''
    });
  };

  const selectCategory = (c: any) => {
    setSelectedCategoryId(c.id);
    setCategoryForm({
      code: c.code || '',
      name: c.name || '',
      default_useful_life_months: String(c.default_useful_life_months ?? 36),
      default_depreciation_method: c.default_depreciation_method || 'straight_line',
      capitalisation_threshold: String(c.capitalisation_threshold ?? 0),
      cost_account_id: c.cost_account_id || c.cost_account?.id || categoryForm.cost_account_id || '',
      accum_dep_account_id:
        c.accum_dep_account_id || c.accum_dep_account?.id || categoryForm.accum_dep_account_id || '',
      dep_expense_account_id:
        c.dep_expense_account_id ||
        c.dep_expense_account?.id ||
        categoryForm.dep_expense_account_id ||
        '',
      is_active: c.is_active !== false
    });
  };

  const saveCategory = async (e: React.FormEvent) => {
    e.preventDefault();
    const body = {
      code: categoryForm.code,
      name: categoryForm.name,
      default_useful_life_months: Number(categoryForm.default_useful_life_months),
      default_depreciation_method: categoryForm.default_depreciation_method,
      capitalisation_threshold: Number(categoryForm.capitalisation_threshold),
      cost_account_id: categoryForm.cost_account_id || undefined,
      accum_dep_account_id: categoryForm.accum_dep_account_id || undefined,
      dep_expense_account_id: categoryForm.dep_expense_account_id || undefined,
      is_active: categoryForm.is_active
    };
    try {
      if (selectedCategoryId) {
        await api.assets.updateCategory(selectedCategoryId, body);
        await alertSuccess('Category updated');
      } else {
        await api.assets.createCategory(body);
        await alertSuccess('Category created');
      }
      resetCategoryForm();
      await load();
    } catch (err: any) {
      await alertError('Category failed', err.message);
    }
  };

  const toggleCategoryActive = async (c: any) => {
    try {
      await api.assets.updateCategory(c.id, { is_active: c.is_active === false });
      await alertSuccess(c.is_active === false ? 'Category enabled' : 'Category disabled');
      if (selectedCategoryId === c.id) {
        setCategoryForm((f) => ({ ...f, is_active: c.is_active === false }));
      }
      await load();
    } catch (err: any) {
      await alertError('Update failed', err.message);
    }
  };

  const createLocation = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await api.assets.createLocation(locationForm);
      await alertSuccess('Location created');
      setLocationForm({ code: '', name: '', description: '' });
      await load();
    } catch (err: any) {
      await alertError('Location failed', err.message);
    }
  };

  const selectAsset = (a: any) => {
    setSelectedId(a.id);
    setEditForm({
      department: a.department || '',
      condition: a.condition || 'good',
      location_id: a.location_id || a.location?.id || '',
      notes: a.notes || ''
    });
  };

  const saveAssetEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedId) return;
    try {
      await api.assets.update(selectedId, {
        department: editForm.department || null,
        condition: editForm.condition,
        location_id: editForm.location_id || null,
        notes: editForm.notes || null
      });
      await alertSuccess('Asset updated');
      await load();
    } catch (err: any) {
      await alertError('Update failed', err.message);
    }
  };

  const previewDep = async () => {
    try {
      const run = await api.assets.previewDepreciation({ period_label: depPeriod });
      setSelectedRun(run);
      await alertSuccess(
        `Preview ${run.run_number}`,
        `${run.included_count || 0} included · ${Number(run.total_amount || 0).toLocaleString()}`
      );
      await load();
      setTab('depreciate');
    } catch (err: any) {
      await alertError('Preview failed', err.message);
    }
  };

  const openRun = async (id: string) => {
    try {
      setSelectedRun(await api.assets.getDepreciationRun(id));
    } catch (err: any) {
      await alertError('Load run failed', err.message);
    }
  };

  const approveDepRun = async (id: string) => {
    try {
      setSelectedRun(await api.assets.approveDepreciationRun(id));
      await alertSuccess('Run approved');
      await load();
    } catch (err: any) {
      await alertError('Approve failed', err.message);
    }
  };

  const postDepRun = async (id: string) => {
    try {
      setSelectedRun(await api.assets.postDepreciationRun(id));
      await alertSuccess('Depreciation posted');
      await load();
    } catch (err: any) {
      await alertError('Post failed', err.message);
    }
  };

  const reverseDepRun = async (id: string) => {
    try {
      setSelectedRun(await api.assets.reverseDepreciationRun(id));
      await alertSuccess('Run reversed');
      await load();
    } catch (err: any) {
      await alertError('Reverse failed', err.message);
    }
  };

  const createBudget = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await api.budgets.create({
        name: budgetForm.name,
        fiscal_year: Number(budgetForm.fiscal_year),
        lines: [
          {
            asset_category_id: budgetForm.asset_category_id,
            period_no: 0,
            amount: Number(budgetForm.amount)
          }
        ]
      });
      await alertSuccess('Budget created');
      setBudgetForm((f) => ({ ...f, name: '', amount: '', asset_category_id: '' }));
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
          Asset Management
        </h1>
        <p style={{ color: 'var(--ink-muted)', margin: '0.35rem 0 0' }}>
          Acquire via draft → approve → capitalise (or classify a posted GRN line from Purchases), then manage the register, depreciation, and budgets.
        </p>
      </header>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {(
          [
            ['register', 'Register'],
            ['categories', 'Categories'],
            ['locations', 'Locations'],
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
          <form
            onSubmit={createAcquisition}
            className="card-surface"
            style={{ padding: '1.25rem', display: 'grid', gap: 12 }}
          >
            <div style={{ fontWeight: 700 }}>Add asset(s)</div>
            <p style={{ margin: 0, color: 'var(--ink-muted)', fontSize: '0.85rem' }}>
              Same model can be bought in bulk. Each unit becomes its own register line with a unique
              serial and auto tag (e.g. COMPUTER-2026-0001). Draft → submit → approve → capitalise;
              GL posts once for the lot on capitalise.
            </p>
            <div className="form-grid">
              <div className="field">
                <label>Asset name</label>
                <input
                  value={acqForm.asset_name}
                  onChange={(e) => setAcqForm({ ...acqForm, asset_name: e.target.value })}
                  placeholder="HP computer ProBook iCore 8 16G"
                  required
                />
              </div>
              <div className="field">
                <label>Manufacturer</label>
                <input
                  value={acqForm.manufacturer}
                  onChange={(e) => setAcqForm({ ...acqForm, manufacturer: e.target.value })}
                  placeholder="HP"
                />
              </div>
              <div className="field">
                <label>Model</label>
                <input
                  value={acqForm.model}
                  onChange={(e) => setAcqForm({ ...acqForm, model: e.target.value })}
                  placeholder="ProBook iCore 8 16G"
                />
              </div>
              <div className="field">
                <label>Category</label>
                <select
                  value={acqForm.category_id}
                  onChange={(e) => setAcqForm({ ...acqForm, category_id: e.target.value })}
                >
                  <option value="">— None —</option>
                  {categories
                    .filter((c) => c.is_active !== false)
                    .map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.code} — {c.name}
                      </option>
                    ))}
                </select>
              </div>
              <div className="field">
                <label>Location</label>
                <select
                  value={acqForm.location_id}
                  onChange={(e) => setAcqForm({ ...acqForm, location_id: e.target.value })}
                >
                  <option value="">— None —</option>
                  {locations
                    .filter((l) => l.is_active !== false)
                    .map((l) => (
                      <option key={l.id} value={l.id}>
                        {l.code} — {l.name}
                      </option>
                    ))}
                </select>
              </div>
              <div className="field">
                <label>Acquisition date</label>
                <input
                  type="date"
                  value={acqForm.acquisition_date}
                  onChange={(e) => setAcqForm({ ...acqForm, acquisition_date: e.target.value })}
                />
              </div>
              <div className="field">
                <label>Quantity</label>
                <input
                  type="number"
                  min="1"
                  max="500"
                  value={acqForm.quantity}
                  onChange={(e) => setAcqForm({ ...acqForm, quantity: e.target.value })}
                  required
                />
              </div>
              <div className="field">
                <label>Unit cost</label>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={acqForm.unit_cost}
                  onChange={(e) => setAcqForm({ ...acqForm, unit_cost: e.target.value })}
                  required
                />
              </div>
              <div className="field">
                <label>Lot total</label>
                <input value={acqLotTotal ? acqLotTotal.toLocaleString() : '—'} readOnly />
              </div>
              <div className="field">
                <label>Salvage (per unit)</label>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={acqForm.salvage_value}
                  onChange={(e) => setAcqForm({ ...acqForm, salvage_value: e.target.value })}
                />
              </div>
              <div className="field">
                <label>Life (months)</label>
                <input
                  type="number"
                  min="1"
                  value={acqForm.useful_life_months}
                  onChange={(e) => setAcqForm({ ...acqForm, useful_life_months: e.target.value })}
                />
              </div>
              <div className="field">
                <label>Source</label>
                <select value={acqForm.source} onChange={(e) => onAcqSourceChange(e.target.value)}>
                  <option value="direct">Direct</option>
                  <option value="opening_balance">Opening balance</option>
                  <option value="donation">Donation</option>
                  <option value="other">Other</option>
                </select>
              </div>
              <div className="field">
                <label>Funding</label>
                <select
                  value={acqForm.funding_method}
                  onChange={(e) => setAcqForm({ ...acqForm, funding_method: e.target.value })}
                >
                  {fundingOptions.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </div>
              {acqForm.funding_method === 'bank' || acqForm.funding_method === 'cash' ? (
                <div className="field">
                  <label>
                    {acqForm.funding_method === 'bank' ? 'Bank account' : 'Cash / till account'}
                    {acqForm.funding_method === 'cash' ? ' (optional)' : ''}
                  </label>
                  <select
                    value={acqForm.bank_account_id}
                    onChange={(e) => setAcqForm({ ...acqForm, bank_account_id: e.target.value })}
                    required={acqForm.funding_method === 'bank'}
                  >
                    {acqForm.funding_method === 'cash' ? (
                      <option value="">Default cash GL</option>
                    ) : (
                      <option value="">— Select bank —</option>
                    )}
                    {bankAccounts.map((ba) => (
                      <option key={ba.id} value={ba.id}>
                        {ba.name}
                        {ba.bank_name ? ` (${ba.bank_name})` : ''}
                        {ba.account_number ? ` · ${ba.account_number}` : ''}
                      </option>
                    ))}
                  </select>
                </div>
              ) : null}
              {acqForm.funding_method === 'credit' ? (
                <div className="field">
                  <label>Supplier</label>
                  <select
                    value={acqForm.supplier_id}
                    onChange={(e) => setAcqForm({ ...acqForm, supplier_id: e.target.value })}
                    required
                  >
                    <option value="">— Select supplier —</option>
                    {suppliers.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.code ? `${s.code} — ` : ''}
                        {s.name}
                      </option>
                    ))}
                  </select>
                </div>
              ) : null}
              <div className="field" style={{ gridColumn: '1 / -1' }}>
                <label>
                  Serial numbers {acqQty > 1 ? `(required: ${acqQty} unique)` : '(optional)'}
                  {acqQty > 1 ? (
                    <span style={{ color: 'var(--ink-muted)', fontWeight: 400 }}>
                      {' '}
                      — {serialLineCount}/{acqQty} entered
                    </span>
                  ) : null}
                </label>
                <textarea
                  rows={Math.min(8, Math.max(3, acqQty))}
                  value={acqForm.serial_numbers_text}
                  onChange={(e) => setAcqForm({ ...acqForm, serial_numbers_text: e.target.value })}
                  placeholder={
                    acqQty > 1
                      ? 'Paste one serial per line\nSN001\nSN002\n…'
                      : 'Optional serial for this unit'
                  }
                  required={acqQty > 1}
                />
              </div>
              <div className="field">
                <label>Notes</label>
                <input
                  value={acqForm.notes}
                  onChange={(e) => setAcqForm({ ...acqForm, notes: e.target.value })}
                />
              </div>
              <div className="form-grid--actions">
                <button className="btn btn-primary" type="submit">
                  Create draft{acqQty > 1 ? ` (${acqQty} units)` : ''}
                </button>
              </div>
            </div>
          </form>

          <div className="card-surface" style={{ padding: '1.25rem' }}>
            <div style={{ fontWeight: 700, marginBottom: 12 }}>Acquisition pipeline</div>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Number</th>
                    <th>Asset</th>
                    <th className="num">Qty</th>
                    <th>Source</th>
                    <th className="num">Lot cost</th>
                    <th>Status</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {acquisitions.filter((r) => r.status !== 'capitalised' && r.status !== 'cancelled')
                    .length === 0 ? (
                    <tr>
                      <td colSpan={7} style={{ color: 'var(--ink-muted)' }}>
                        No open acquisitions — capitalised assets show in the register below
                      </td>
                    </tr>
                  ) : (
                    acquisitions
                      .filter((r) => r.status !== 'capitalised' && r.status !== 'cancelled')
                      .map((row) => (
                        <tr key={row.id}>
                          <td>{row.acquisition_number}</td>
                          <td>
                            {row.asset_name}
                            {row.model ? (
                              <div style={{ color: 'var(--ink-muted)', fontSize: '0.8rem' }}>
                                {row.manufacturer ? `${row.manufacturer} · ` : ''}
                                {row.model}
                              </div>
                            ) : null}
                          </td>
                          <td className="num">{row.quantity || 1}</td>
                          <td>
                            {row.source} / {row.funding_method}
                          </td>
                          <td className="num">
                            {Number(row.capitalised_cost ?? row.purchase_cost).toLocaleString()}
                          </td>
                          <td>{row.status}</td>
                          <td>
                            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                              {row.status === 'draft' ? (
                                <>
                                  <button
                                    type="button"
                                    className="btn btn-ghost"
                                    onClick={() => void runAcqAction(row.id, 'submit')}
                                  >
                                    Submit
                                  </button>
                                  <button
                                    type="button"
                                    className="btn btn-ghost"
                                    onClick={() => void runAcqAction(row.id, 'approve')}
                                  >
                                    Approve
                                  </button>
                                  <button
                                    type="button"
                                    className="btn btn-ghost"
                                    onClick={() => void runAcqAction(row.id, 'cancel')}
                                  >
                                    Cancel
                                  </button>
                                </>
                              ) : null}
                              {row.status === 'pending_approval' ? (
                                <>
                                  <button
                                    type="button"
                                    className="btn btn-ghost"
                                    onClick={() => void runAcqAction(row.id, 'approve')}
                                  >
                                    Approve
                                  </button>
                                  <button
                                    type="button"
                                    className="btn btn-ghost"
                                    onClick={() => void runAcqAction(row.id, 'cancel')}
                                  >
                                    Cancel
                                  </button>
                                </>
                              ) : null}
                              {row.status === 'approved' ? (
                                <button
                                  type="button"
                                  className="btn btn-primary"
                                  onClick={() => void runAcqAction(row.id, 'capitalise')}
                                >
                                  Capitalise
                                </button>
                              ) : null}
                            </div>
                          </td>
                        </tr>
                      ))
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div className="card-surface" style={{ padding: '0.75rem 1rem', display: 'grid', gap: 8 }}>
            <div style={{ fontWeight: 700 }}>Asset register</div>
            <div className="form-grid">
              <div className="field" style={{ margin: 0 }}>
                <label>Filter by name / code</label>
                <input
                  value={nameFilter}
                  onChange={(e) => setNameFilter(e.target.value)}
                  onBlur={() => void load()}
                  placeholder="Search…"
                />
              </div>
              <div className="field" style={{ margin: 0 }}>
                <label>Filter by category</label>
                <select
                  value={categoryFilter}
                  onChange={(e) => {
                    setCategoryFilter(e.target.value);
                    setTimeout(() => void load(), 0);
                  }}
                >
                  <option value="">All categories</option>
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.code} — {c.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="form-grid--actions">
                <button type="button" className="btn btn-ghost" onClick={() => void load()}>
                  Apply filters
                </button>
              </div>
            </div>
          </div>

          <div className="card-surface" style={{ padding: '0.5rem 0' }}>
            <div className="table-wrap">
              <table className="table">
              <thead>
                <tr>
                  <th>Tag</th>
                  <th>Name</th>
                  <th>Serial</th>
                  <th>Category</th>
                  <th>Location</th>
                  <th className="num">Cost</th>
                  <th className="num">Accum. dep.</th>
                  <th className="num">NBV</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {assets.map((a) => (
                  <tr
                    key={a.id}
                    onClick={() => selectAsset(a)}
                    style={
                      selectedId === a.id
                        ? { background: 'color-mix(in srgb, var(--brand, #0f5c4c) 8%, transparent)', cursor: 'pointer' }
                        : { cursor: 'pointer' }
                    }
                  >
                    <td>{a.code || '—'}</td>
                    <td>
                      {a.name}
                      {a.model ? (
                        <div style={{ color: 'var(--ink-muted)', fontSize: '0.8rem' }}>
                          {[a.manufacturer, a.model].filter(Boolean).join(' · ')}
                        </div>
                      ) : null}
                    </td>
                    <td>{a.serial_number || '—'}</td>
                    <td>{a.asset_category?.name || a.category}</td>
                    <td>{a.location?.name || '—'}</td>
                    <td className="num">{Number(a.purchase_cost).toLocaleString()}</td>
                    <td className="num">{Number(a.accumulated_depreciation).toLocaleString()}</td>
                    <td className="num">{Number(a.net_book_value ?? 0).toLocaleString()}</td>
                    <td>{a.operational_status || a.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          </div>

          {selectedId ? (
            <form onSubmit={saveAssetEdit} className="card-surface" style={{ padding: '1.25rem', display: 'grid', gap: 12 }}>
              <div style={{ fontWeight: 700 }}>
                Edit assignment — {assets.find((a) => a.id === selectedId)?.name}
              </div>
              <p style={{ margin: 0, color: 'var(--ink-muted)', fontSize: '0.85rem' }}>
                Financial balances cannot be edited here. Assignment changes are history-tracked.
              </p>
              <div className="form-grid">
                <div className="field">
                  <label>Department</label>
                  <input
                    value={editForm.department}
                    onChange={(e) => setEditForm({ ...editForm, department: e.target.value })}
                  />
                </div>
                <div className="field">
                  <label>Condition</label>
                  <select
                    value={editForm.condition}
                    onChange={(e) => setEditForm({ ...editForm, condition: e.target.value })}
                  >
                    <option value="new">New</option>
                    <option value="good">Good</option>
                    <option value="fair">Fair</option>
                    <option value="poor">Poor</option>
                    <option value="damaged">Damaged</option>
                  </select>
                </div>
                <div className="field">
                  <label>Location</label>
                  <select
                    value={editForm.location_id}
                    onChange={(e) => setEditForm({ ...editForm, location_id: e.target.value })}
                  >
                    <option value="">— None —</option>
                    {locations.map((l) => (
                      <option key={l.id} value={l.id}>
                        {l.code} — {l.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="field">
                  <label>Notes</label>
                  <input
                    value={editForm.notes}
                    onChange={(e) => setEditForm({ ...editForm, notes: e.target.value })}
                  />
                </div>
                <div className="form-grid--actions">
                  <button className="btn btn-primary" type="submit">
                    Save changes
                  </button>
                </div>
              </div>
            </form>
          ) : null}
        </>
      ) : null}

      {tab === 'categories' ? (
        <>
          <form onSubmit={saveCategory} className="card-surface" style={{ padding: '1.25rem', display: 'grid', gap: 12 }}>
            <div style={{ fontWeight: 700 }}>
              {selectedCategoryId ? 'Edit asset category' : 'New asset category'}
            </div>
            <div className="form-grid">
              <div className="field">
                <label>Code</label>
                <input value={categoryForm.code} onChange={(e) => setCategoryForm({ ...categoryForm, code: e.target.value })} required />
              </div>
              <div className="field">
                <label>Name</label>
                <input value={categoryForm.name} onChange={(e) => setCategoryForm({ ...categoryForm, name: e.target.value })} required />
              </div>
              <div className="field">
                <label>Default life (months)</label>
                <input type="number" min="0" value={categoryForm.default_useful_life_months} onChange={(e) => setCategoryForm({ ...categoryForm, default_useful_life_months: e.target.value })} />
              </div>
              <div className="field">
                <label>Method</label>
                <select
                  value={categoryForm.default_depreciation_method}
                  onChange={(e) => {
                    const method = e.target.value;
                    setCategoryForm({
                      ...categoryForm,
                      default_depreciation_method: method,
                      default_useful_life_months:
                        method === 'none' ? '0' : categoryForm.default_useful_life_months === '0'
                          ? '36'
                          : categoryForm.default_useful_life_months
                    });
                  }}
                  required
                >
                  <option value="straight_line">Straight line</option>
                  <option value="reducing_balance">Reducing balance</option>
                  <option value="units_of_production">Units of production</option>
                  <option value="none">None (non-depreciable)</option>
                </select>
              </div>
              <div className="field">
                <label>Capitalisation threshold</label>
                <input type="number" min="0" step="0.01" value={categoryForm.capitalisation_threshold} onChange={(e) => setCategoryForm({ ...categoryForm, capitalisation_threshold: e.target.value })} />
              </div>
              <div className="field">
                <label>Cost account</label>
                <select value={categoryForm.cost_account_id} onChange={(e) => setCategoryForm({ ...categoryForm, cost_account_id: e.target.value })}>
                  {glAccounts.filter((a) => a.account_type === 'asset').map((a) => (
                    <option key={a.id} value={a.id}>{a.code} — {a.name}</option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label>Accum. depreciation</label>
                <select value={categoryForm.accum_dep_account_id} onChange={(e) => setCategoryForm({ ...categoryForm, accum_dep_account_id: e.target.value })}>
                  {glAccounts.filter((a) => a.account_type === 'asset').map((a) => (
                    <option key={a.id} value={a.id}>{a.code} — {a.name}</option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label>Depreciation expense</label>
                <select value={categoryForm.dep_expense_account_id} onChange={(e) => setCategoryForm({ ...categoryForm, dep_expense_account_id: e.target.value })}>
                  {glAccounts.filter((a) => a.account_type === 'expense').map((a) => (
                    <option key={a.id} value={a.id}>{a.code} — {a.name}</option>
                  ))}
                </select>
              </div>
              {selectedCategoryId ? (
                <div className="field">
                  <label>Status</label>
                  <select
                    value={categoryForm.is_active ? 'active' : 'inactive'}
                    onChange={(e) =>
                      setCategoryForm({ ...categoryForm, is_active: e.target.value === 'active' })
                    }
                  >
                    <option value="active">Active</option>
                    <option value="inactive">Disabled</option>
                  </select>
                </div>
              ) : null}
              <div className="form-grid--actions" style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button className="btn btn-primary" type="submit">
                  {selectedCategoryId ? 'Update category' : 'Save category'}
                </button>
                {selectedCategoryId ? (
                  <button
                    className="btn btn-ghost"
                    type="button"
                    onClick={() => resetCategoryForm()}
                  >
                    Cancel edit
                  </button>
                ) : null}
              </div>
            </div>
          </form>
          <div className="card-surface" style={{ padding: '0.5rem 0' }}>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Code</th>
                    <th>Name</th>
                    <th>Life</th>
                    <th>Method</th>
                    <th>Threshold</th>
                    <th>Active</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {categories.map((c) => (
                    <tr
                      key={c.id}
                      onClick={() => selectCategory(c)}
                      style={
                        selectedCategoryId === c.id
                          ? {
                              background:
                                'color-mix(in srgb, var(--brand, #0f5c4c) 8%, transparent)',
                              cursor: 'pointer',
                              opacity: c.is_active === false ? 0.7 : 1
                            }
                          : { cursor: 'pointer', opacity: c.is_active === false ? 0.7 : 1 }
                      }
                    >
                      <td>{c.code}</td>
                      <td>{c.name}</td>
                      <td>{c.default_useful_life_months}</td>
                      <td>{c.default_depreciation_method}</td>
                      <td>{Number(c.capitalisation_threshold).toLocaleString()}</td>
                      <td>{c.is_active === false ? 'No' : 'Yes'}</td>
                      <td>
                        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                          <button
                            type="button"
                            className="btn btn-ghost"
                            onClick={(e) => {
                              e.stopPropagation();
                              selectCategory(c);
                            }}
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            className="btn btn-ghost"
                            onClick={(e) => {
                              e.stopPropagation();
                              void toggleCategoryActive(c);
                            }}
                          >
                            {c.is_active === false ? 'Enable' : 'Disable'}
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      ) : null}

      {tab === 'locations' ? (
        <>
          <form onSubmit={createLocation} className="card-surface" style={{ padding: '1.25rem', display: 'grid', gap: 12 }}>
            <div style={{ fontWeight: 700 }}>New asset location</div>
            <div className="form-grid">
              <div className="field">
                <label>Code</label>
                <input value={locationForm.code} onChange={(e) => setLocationForm({ ...locationForm, code: e.target.value })} required />
              </div>
              <div className="field">
                <label>Name</label>
                <input value={locationForm.name} onChange={(e) => setLocationForm({ ...locationForm, name: e.target.value })} required />
              </div>
              <div className="field">
                <label>Description</label>
                <input value={locationForm.description} onChange={(e) => setLocationForm({ ...locationForm, description: e.target.value })} />
              </div>
              <div className="form-grid--actions">
                <button className="btn btn-primary" type="submit">Save location</button>
              </div>
            </div>
          </form>
          <div className="card-surface" style={{ padding: '0.5rem 0' }}>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Code</th>
                    <th>Name</th>
                    <th>Branch</th>
                    <th>Active</th>
                  </tr>
                </thead>
                <tbody>
                  {locations.map((l) => (
                    <tr key={l.id}>
                      <td>{l.code}</td>
                      <td>{l.name}</td>
                      <td>{l.branch?.code || '—'}</td>
                      <td>{l.is_active === false ? 'No' : 'Yes'}</td>
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
          <div
            className="card-surface"
            style={{ padding: '1.25rem', display: 'flex', gap: 12, alignItems: 'end', flexWrap: 'wrap' }}
          >
            <div className="field">
              <label>Period (YYYY-MM)</label>
              <input value={depPeriod} onChange={(e) => setDepPeriod(e.target.value)} required />
            </div>
            <button type="button" className="btn btn-primary" onClick={() => void previewDep()}>
              Preview run
            </button>
            <span style={{ color: 'var(--ink-muted)', fontSize: 14 }}>
              Preview → approve → post. Methods: straight-line, reducing balance, units of production, none
              (land). Posted runs can be reversed.
            </span>
          </div>

          <div className="card-surface" style={{ padding: '0.5rem 0' }}>
            <div style={{ fontWeight: 700, padding: '0.5rem 1rem' }}>Runs</div>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Run</th>
                    <th>Period</th>
                    <th>Status</th>
                    <th>Included</th>
                    <th>Total</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {depRuns.map((r) => (
                    <tr key={r.id}>
                      <td>{r.run_number}</td>
                      <td>{r.period_label}</td>
                      <td>{r.status}</td>
                      <td>{r.included_count}</td>
                      <td>{Number(r.total_amount).toLocaleString()}</td>
                      <td style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                        <button type="button" className="btn btn-ghost" onClick={() => void openRun(r.id)}>
                          Open
                        </button>
                        {r.status === 'previewed' ? (
                          <button
                            type="button"
                            className="btn btn-ghost"
                            onClick={() => void approveDepRun(r.id)}
                          >
                            Approve
                          </button>
                        ) : null}
                        {r.status === 'approved' ? (
                          <button
                            type="button"
                            className="btn btn-ghost"
                            onClick={() => void postDepRun(r.id)}
                          >
                            Post
                          </button>
                        ) : null}
                        {r.status === 'posted' ? (
                          <button
                            type="button"
                            className="btn btn-ghost"
                            onClick={() => void reverseDepRun(r.id)}
                          >
                            Reverse
                          </button>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                  {!depRuns.length ? (
                    <tr>
                      <td colSpan={6} style={{ color: 'var(--ink-muted)' }}>
                        No depreciation runs yet
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </div>

          {selectedRun ? (
            <div className="card-surface" style={{ padding: '1rem' }}>
              <div style={{ fontWeight: 700, marginBottom: 8 }}>
                {selectedRun.run_number} — {selectedRun.period_label} ({selectedRun.status})
              </div>
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Asset</th>
                      <th>Method</th>
                      <th>Amount</th>
                      <th>Status</th>
                      <th>Note</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(selectedRun.lines || []).map((l: any) => (
                      <tr key={l.id}>
                        <td>
                          {l.asset?.code ? `${l.asset.code} — ` : ''}
                          {l.asset?.name || l.asset_id}
                        </td>
                        <td>{l.method}</td>
                        <td>{Number(l.amount).toLocaleString()}</td>
                        <td>{l.line_status}</td>
                        <td style={{ color: 'var(--ink-muted)', fontSize: 13 }}>
                          {l.exception_reason || '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}

          <div className="card-surface" style={{ padding: '0.5rem 0' }}>
            <div style={{ fontWeight: 700, padding: '0.5rem 1rem' }}>Posted entries</div>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Period</th>
                    <th>Asset</th>
                    <th>Amount</th>
                    <th>Status</th>
                    <th>Date</th>
                  </tr>
                </thead>
                <tbody>
                  {deps.map((d) => (
                    <tr key={d.id}>
                      <td>{d.period_label}</td>
                      <td>{d.asset?.name}</td>
                      <td>{Number(d.amount).toLocaleString()}</td>
                      <td>{d.status || 'posted'}</td>
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
                <label>Category</label>
                <select
                  value={budgetForm.asset_category_id}
                  onChange={(e) => setBudgetForm({ ...budgetForm, asset_category_id: e.target.value })}
                  required
                >
                  <option value="">Select category…</option>
                  {categories
                    .filter((c) => c.is_active !== false)
                    .map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.code} — {c.name}
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
                    <th>Category</th>
                    <th>Budget</th>
                    <th>Actual (capitalised)</th>
                    <th>Variance</th>
                  </tr>
                </thead>
                <tbody>
                  {(vsActual.lines || []).map((l: any, i: number) => (
                    <tr key={i}>
                      <td>
                        {l.asset_category
                          ? `${l.asset_category.code} — ${l.asset_category.name}`
                          : `${l.account?.code || ''} ${l.account?.name || ''}`.trim() || '—'}
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
