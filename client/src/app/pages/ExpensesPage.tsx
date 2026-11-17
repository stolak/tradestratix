import React, { useEffect, useState } from 'react';
import { api } from '../utils/api';
import { alertError, alertSuccess, confirmAction } from '../utils/alerts';

type PageTab = 'expenses' | 'categories';

const emptyCategoryForm = {
  name: '',
  code: '',
  account_id: '',
  description: '',
  sort_order: '0'
};

export const ExpensesPage: React.FC = () => {
  const [tab, setTab] = useState<PageTab>('expenses');
  const [rows, setRows] = useState<any[]>([]);
  const [categories, setCategories] = useState<any[]>([]);
  const [glAccounts, setGlAccounts] = useState<any[]>([]);
  const [fundingAccounts, setFundingAccounts] = useState<any[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [editingCategoryId, setEditingCategoryId] = useState<string | null>(null);
  const [categoryForm, setCategoryForm] = useState(emptyCategoryForm);
  const [form, setForm] = useState({
    expense_category_id: '',
    amount: '',
    description: '',
    funding_account_id: ''
  });

  const load = async () => {
    try {
      const [e, cats, gl, funding] = await Promise.all([
        api.expenses.list(),
        api.expenses.categories(),
        api.accounting.accounts({ parent_setting_key: 'expense_ledgers' }),
        api.accounting.accounts({ parent_setting_key: 'cash_ledgers' })
      ]);
      setRows(e);
      setCategories(cats);
      setGlAccounts(gl);
      setFundingAccounts(funding);

      const activeCats = cats.filter((c: any) => c.is_active);
      const defaultCat = activeCats[0];
      const defExpenseGl =
        (defaultCat && gl.find((a: any) => a.id === defaultCat.account_id)) ||
        gl.find((a: any) => a.code === '6400') ||
        gl[0];
      const defFunding =
        funding.find((a: any) => a.code === '1110') ||
        funding.find((a: any) => a.code === '1115') ||
        funding[0];

      setForm((f) => ({
        ...f,
        expense_category_id: f.expense_category_id || defaultCat?.id || '',
        funding_account_id: f.funding_account_id || defFunding?.id || ''
      }));
      setCategoryForm((cf) => ({
        ...cf,
        account_id: cf.account_id || defExpenseGl?.id || ''
      }));
    } catch (err: any) {
      await alertError('Expenses', err.message);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.expense_category_id) {
      await alertError('Create failed', 'Category is required');
      return;
    }
    if (!form.funding_account_id) {
      await alertError('Create failed', 'Paid from account is required');
      return;
    }
    try {
      await api.expenses.create({
        funding_account_id: form.funding_account_id,
        lines: [
          {
            expense_category_id: form.expense_category_id,
            amount: Number(form.amount),
            description: form.description || undefined
          }
        ]
      });
      await alertSuccess('Draft expense created');
      setForm((f) => ({ ...f, amount: '', description: '' }));
      await load();
    } catch (err: any) {
      await alertError('Create failed', err.message);
    }
  };

  const post = async (id: string) => {
    setBusyId(id);
    try {
      await api.expenses.post(id, {});
      await alertSuccess('Expense posted');
      await load();
    } catch (err: any) {
      await alertError('Post failed', err.message);
    } finally {
      setBusyId(null);
    }
  };

  const cancelDraft = async (r: any) => {
    const ok = await confirmAction(
      'Cancel draft?',
      `Delete draft ${r.expense_number}? This cannot be undone.`
    );
    if (!ok) return;
    setBusyId(r.id);
    try {
      await api.expenses.remove(r.id);
      await alertSuccess('Draft cancelled');
      await load();
    } catch (err: any) {
      await alertError('Cancel failed', err.message);
    } finally {
      setBusyId(null);
    }
  };

  const resetCategoryForm = () => {
    setEditingCategoryId(null);
    setCategoryForm({
      ...emptyCategoryForm,
      account_id: glAccounts.find((a: any) => a.code === '6400')?.id || glAccounts[0]?.id || ''
    });
  };

  const editCategory = (c: any) => {
    setEditingCategoryId(c.id);
    setCategoryForm({
      name: c.name || '',
      code: c.code || '',
      account_id: c.account_id || '',
      description: c.description || '',
      sort_order: String(c.sort_order ?? 0)
    });
    setTab('categories');
  };

  const saveCategory = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const body = {
        name: categoryForm.name.trim(),
        code: categoryForm.code.trim() || undefined,
        account_id: categoryForm.account_id,
        description: categoryForm.description.trim() || undefined,
        sort_order: Number(categoryForm.sort_order) || 0
      };
      if (editingCategoryId) {
        await api.expenses.updateCategory(editingCategoryId, body);
        await alertSuccess('Category updated');
      } else {
        await api.expenses.createCategory(body);
        await alertSuccess('Category created');
      }
      resetCategoryForm();
      await load();
    } catch (err: any) {
      await alertError('Category save failed', err.message);
    }
  };

  const toggleCategoryActive = async (c: any) => {
    setBusyId(c.id);
    try {
      await api.expenses.updateCategory(c.id, { is_active: !c.is_active });
      await alertSuccess(c.is_active ? 'Category disabled' : 'Category enabled');
      await load();
    } catch (err: any) {
      await alertError('Update failed', err.message);
    } finally {
      setBusyId(null);
    }
  };

  const removeCategory = async (c: any) => {
    const ok = await confirmAction(
      'Delete category?',
      `Delete “${c.name}”? This is only allowed when no expense lines use it.`
    );
    if (!ok) return;
    setBusyId(c.id);
    try {
      await api.expenses.deleteCategory(c.id);
      await alertSuccess('Category deleted');
      if (editingCategoryId === c.id) resetCategoryForm();
      await load();
    } catch (err: any) {
      await alertError('Delete failed', err.message);
    } finally {
      setBusyId(null);
    }
  };

  const activeCategories = categories.filter((c) => c.is_active);

  return (
    <div className="page-stack">
      <header>
        <h1 className="display" style={{ margin: 0, fontSize: '2.2rem' }}>
          Expenses
        </h1>
        <p style={{ color: 'var(--ink-muted)', margin: '0.35rem 0 0' }}>
          {tab === 'categories'
            ? 'Named expense types mapped to GL accounts for pickers and reporting.'
            : 'Create drafts, then Post to draw from a cash/bank GL — or Cancel while still draft.'}
        </p>
        <div style={{ display: 'flex', gap: 8, marginTop: 14, flexWrap: 'wrap' }}>
          <button
            type="button"
            className={`btn ${tab === 'expenses' ? 'btn-primary' : 'btn-ghost'}`}
            onClick={() => setTab('expenses')}
          >
            Expenses
          </button>
          <button
            type="button"
            className={`btn ${tab === 'categories' ? 'btn-primary' : 'btn-ghost'}`}
            onClick={() => setTab('categories')}
          >
            Categories
          </button>
        </div>
      </header>

      {tab === 'expenses' ? (
        <>
          <form
            onSubmit={create}
            className="card-surface"
            style={{ padding: '1.25rem', display: 'grid', gap: 12 }}
          >
            <div style={{ fontWeight: 700 }}>New expense</div>
            <div className="form-grid">
              <div className="field">
                <label>Category</label>
                <select
                  value={form.expense_category_id}
                  onChange={(e) =>
                    setForm({ ...form, expense_category_id: e.target.value })
                  }
                  required
                >
                  <option value="">— Select category —</option>
                  {activeCategories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                      {c.account ? ` → ${c.account.code}` : ''}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label>Amount</label>
                <input
                  type="number"
                  min="0.01"
                  step="any"
                  value={form.amount}
                  onChange={(e) => setForm({ ...form, amount: e.target.value })}
                  required
                />
              </div>
              <div className="field">
                <label>Description</label>
                <input
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                />
              </div>
              <div className="field">
                <label>Paid from</label>
                <select
                  value={form.funding_account_id}
                  onChange={(e) =>
                    setForm({ ...form, funding_account_id: e.target.value })
                  }
                  required
                >
                  {fundingAccounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.code} — {a.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="form-grid--actions">
                <button className="btn btn-primary" type="submit">
                  Create
                </button>
              </div>
            </div>
          </form>

          <div className="card-surface" style={{ padding: '0.5rem 0' }}>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Expense #</th>
                    <th>Category</th>
                    <th>Paid from</th>
                    <th>Status</th>
                    <th>Payment</th>
                    <th>Total</th>
                    <th>Balance</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => {
                    const catName =
                      r.lines?.[0]?.expense_category?.name ||
                      r.lines?.[0]?.expenseCategory?.name ||
                      '—';
                    const funding =
                      r.funding_account ||
                      r.fundingAccount ||
                      null;
                    const fundingLabel = funding
                      ? `${funding.code} — ${funding.name}`
                      : '—';
                    const busy = busyId === r.id;
                    return (
                      <tr key={r.id}>
                        <td>{r.expense_number}</td>
                        <td>{catName}</td>
                        <td>{fundingLabel}</td>
                        <td>{r.status}</td>
                        <td>{r.payment_status}</td>
                        <td>{Number(r.total_amount).toLocaleString()}</td>
                        <td>{Number(r.balance).toLocaleString()}</td>
                        <td>
                          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                            {r.status === 'draft' ? (
                              <>
                                <button
                                  type="button"
                                  className="btn btn-ghost"
                                  disabled={busy}
                                  onClick={() => void post(r.id)}
                                >
                                  Post
                                </button>
                                <button
                                  type="button"
                                  className="btn btn-ghost"
                                  disabled={busy}
                                  onClick={() => void cancelDraft(r)}
                                >
                                  Cancel
                                </button>
                              </>
                            ) : null}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </>
      ) : (
        <>
          <form
            onSubmit={saveCategory}
            className="card-surface"
            style={{ padding: '1.25rem', display: 'grid', gap: 12 }}
          >
            {editingCategoryId ? (
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                <strong>Editing category</strong>
                <button type="button" className="btn btn-ghost" onClick={resetCategoryForm}>
                  Cancel
                </button>
              </div>
            ) : (
              <div style={{ fontWeight: 700 }}>Add category</div>
            )}
            <div className="form-grid">
              <div className="field">
                <label>Name</label>
                <input
                  value={categoryForm.name}
                  onChange={(e) => setCategoryForm({ ...categoryForm, name: e.target.value })}
                  required
                />
              </div>
              <div className="field">
                <label>Code</label>
                <input
                  value={categoryForm.code}
                  onChange={(e) => setCategoryForm({ ...categoryForm, code: e.target.value })}
                  placeholder="Optional"
                />
              </div>
              <div className="field">
                <label>GL account</label>
                <select
                  value={categoryForm.account_id}
                  onChange={(e) =>
                    setCategoryForm({ ...categoryForm, account_id: e.target.value })
                  }
                  required
                >
                  {glAccounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.code} — {a.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label>Sort order</label>
                <input
                  type="number"
                  value={categoryForm.sort_order}
                  onChange={(e) =>
                    setCategoryForm({ ...categoryForm, sort_order: e.target.value })
                  }
                />
              </div>
              <div className="field">
                <label>Description</label>
                <input
                  value={categoryForm.description}
                  onChange={(e) =>
                    setCategoryForm({ ...categoryForm, description: e.target.value })
                  }
                />
              </div>
              <div className="form-grid--actions">
                <button className="btn btn-primary" type="submit">
                  {editingCategoryId ? 'Save changes' : 'Add category'}
                </button>
              </div>
            </div>
          </form>

          <div className="card-surface" style={{ padding: '0.5rem 0' }}>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>S/N</th>
                    <th>Name</th>
                    <th>Code</th>
                    <th>GL account</th>
                    <th>Lines</th>
                    <th>Status</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {categories.map((c, index) => {
                    const busy = busyId === c.id;
                    const canDelete = Boolean(c.can_delete);
                    return (
                      <tr
                        key={c.id}
                        style={{
                          background:
                            editingCategoryId === c.id ? 'rgba(15,92,76,0.06)' : undefined,
                          opacity: c.is_active ? 1 : 0.72
                        }}
                      >
                        <td>{index + 1}</td>
                        <td>{c.name}</td>
                        <td>{c.code || '—'}</td>
                        <td>
                          {c.account
                            ? `${c.account.code} — ${c.account.name}`
                            : c.account_id}
                        </td>
                        <td>{c.line_count ?? 0}</td>
                        <td>{c.is_active ? 'Active' : 'Disabled'}</td>
                        <td>
                          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                            <button
                              type="button"
                              className="btn btn-ghost"
                              disabled={busy}
                              onClick={() => editCategory(c)}
                            >
                              Edit
                            </button>
                            <button
                              type="button"
                              className="btn btn-ghost"
                              disabled={busy}
                              onClick={() => void toggleCategoryActive(c)}
                            >
                              {c.is_active ? 'Disable' : 'Enable'}
                            </button>
                            <button
                              type="button"
                              className="btn btn-ghost"
                              disabled={busy || !canDelete}
                              title={
                                canDelete
                                  ? 'Delete unused category'
                                  : 'In use — disable instead'
                              }
                              onClick={() => void removeCategory(c)}
                            >
                              Delete
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
};
