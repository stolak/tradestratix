import React, { useEffect, useMemo, useState } from 'react';
import { RotateCcw, Save, Search } from 'lucide-react';
import { api } from '../utils/api';
import { alertError, alertSuccess, confirmAction } from '../utils/alerts';
import { useAuth } from '../context/AuthContext';

type PriceRow = {
  selling_price_id: string;
  uom: { id: string; code: string; name: string };
  price_level: string;
  label?: string | null;
  is_default?: boolean;
  global_unit_price: number;
  branch_unit_price: number | null;
  pre_discount_unit_price: number;
  effective_unit_price: number;
};

type ProductRow = {
  id: string;
  name: string;
  sku?: string | null;
  discount_percent: number | null;
  prices: PriceRow[];
};

type Filter = 'all' | 'overridden';

const money = (n: number) =>
  Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const BranchPricingPage: React.FC = () => {
  const { branches, activeBranchId, can } = useAuth();
  const canEdit = can('products.branch_price');
  const [branchId, setBranchId] = useState(activeBranchId || branches[0]?.id || '');
  const [products, setProducts] = useState<ProductRow[]>([]);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [discountDrafts, setDiscountDrafts] = useState<Record<string, string>>({});
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [loading, setLoading] = useState(false);
  const [savingId, setSavingId] = useState<string | null>(null);

  const load = async (target = branchId) => {
    if (!target) return;
    setLoading(true);
    try {
      const res = await api.products.branchPrices(target);
      setProducts(res.products || []);
      setDrafts({});
      setDiscountDrafts({});
    } catch (err: any) {
      await alertError('Branch pricing', err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load(branchId);
  }, [branchId]);

  useEffect(() => {
    if (activeBranchId && !branchId) setBranchId(activeBranchId);
  }, [activeBranchId]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return products
      .filter(
        (p) =>
          !q ||
          p.name.toLowerCase().includes(q) ||
          String(p.sku || '').toLowerCase().includes(q)
      )
      .map((p) => ({
        ...p,
        prices:
          filter === 'overridden' && p.discount_percent == null
            ? p.prices.filter((r) => r.branch_unit_price != null)
            : p.prices
      }))
      .filter((p) => p.prices.length);
  }, [products, query, filter]);

  const overrideCount = useMemo(
    () => products.reduce((n, p) => n + p.prices.filter((r) => r.branch_unit_price != null).length, 0),
    [products]
  );
  const discountCount = useMemo(
    () => products.filter((p) => p.discount_percent != null).length,
    [products]
  );

  const discountDraftValue = (p: ProductRow) =>
    discountDrafts[p.id] ?? (p.discount_percent != null ? String(p.discount_percent) : '');

  const isDiscountDirty = (p: ProductRow) => {
    const d = discountDrafts[p.id];
    if (d == null || d.trim() === '') return false;
    return Number(d) !== (p.discount_percent ?? NaN);
  };

  const saveDiscount = async (p: ProductRow) => {
    const value = Number(discountDrafts[p.id]);
    if (!Number.isFinite(value) || value <= 0 || value >= 100) {
      await alertError('Invalid discount', 'Enter a percentage greater than 0 and less than 100');
      return;
    }
    setSavingId(p.id);
    try {
      await api.products.setBranchDiscount({
        branch_id: branchId,
        product_id: p.id,
        discount_percent: value
      });
      await load();
      await alertSuccess('Branch discount saved');
    } catch (err: any) {
      await alertError('Save failed', err.message);
    } finally {
      setSavingId(null);
    }
  };

  const clearDiscount = async (p: ProductRow) => {
    const ok = await confirmAction(
      'Remove discount?',
      `${p.name} will no longer be discounted in ${branchName?.name || 'this branch'}.`
    );
    if (!ok) return;
    setSavingId(p.id);
    try {
      await api.products.clearBranchDiscount(branchId, p.id);
      await load();
    } catch (err: any) {
      await alertError('Remove failed', err.message);
    } finally {
      setSavingId(null);
    }
  };

  const branchName = branches.find((b) => b.id === branchId);

  const draftValue = (row: PriceRow) =>
    drafts[row.selling_price_id] ??
    (row.branch_unit_price != null ? String(row.branch_unit_price) : '');

  const isDirty = (row: PriceRow) => {
    const d = drafts[row.selling_price_id];
    if (d == null || d.trim() === '') return false;
    return Number(d) !== (row.branch_unit_price ?? NaN);
  };

  const save = async (row: PriceRow) => {
    const value = Number(drafts[row.selling_price_id]);
    if (!Number.isFinite(value) || value < 0) {
      await alertError('Invalid price', 'Enter a price of 0 or more');
      return;
    }
    setSavingId(row.selling_price_id);
    try {
      await api.products.setBranchPrice({
        branch_id: branchId,
        selling_price_id: row.selling_price_id,
        unit_price: value
      });
      await load();
      await alertSuccess('Branch price saved');
    } catch (err: any) {
      await alertError('Save failed', err.message);
    } finally {
      setSavingId(null);
    }
  };

  const reset = async (product: ProductRow, row: PriceRow) => {
    const ok = await confirmAction(
      'Use global price?',
      `${product.name} (${row.uom.code} · ${row.price_level}) will sell at the global price of ${money(
        row.global_unit_price
      )} in ${branchName?.name || 'this branch'}.`
    );
    if (!ok) return;
    setSavingId(row.selling_price_id);
    try {
      await api.products.clearBranchPrice(branchId, row.selling_price_id);
      await load();
    } catch (err: any) {
      await alertError('Reset failed', err.message);
    } finally {
      setSavingId(null);
    }
  };

  return (
    <div className="page-stack">
      <header>
        <h1 className="display" style={{ margin: 0, fontSize: '2.2rem' }}>
          Branch pricing
        </h1>
        <p style={{ color: 'var(--ink-muted)', margin: '0.35rem 0 0' }}>
          Override a product's selling price or give it a % discount in one branch. Without an
          override the global selling price applies; a discount applies on top of whichever price
          the branch uses.
        </p>
      </header>

      <div className="card-surface" style={{ padding: '1.25rem', display: 'grid', gap: 14 }}>
        <div className="form-grid">
          <div className="field">
            <label>Branch</label>
            <select value={branchId} onChange={(e) => setBranchId(e.target.value)}>
              {branches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name} ({b.code})
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>Search</label>
            <div style={{ position: 'relative' }}>
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Product name or SKU…"
                style={{ paddingLeft: '2.2rem' }}
              />
              <Search
                size={15}
                style={{
                  position: 'absolute',
                  left: '0.75rem',
                  top: '50%',
                  transform: 'translateY(-50%)',
                  color: 'var(--ink-muted)'
                }}
              />
            </div>
          </div>
          <div className="field">
            <label>Show</label>
            <select value={filter} onChange={(e) => setFilter(e.target.value as Filter)}>
              <option value="all">All prices</option>
              <option value="overridden">Overrides &amp; discounts only</option>
            </select>
          </div>
        </div>

        <div className="branch-pricing__summary">
          <span>
            <strong>{overrideCount}</strong> price override{overrideCount === 1 ? '' : 's'} ·{' '}
            <strong>{discountCount}</strong> discounted product{discountCount === 1 ? '' : 's'} in{' '}
            {branchName?.name || 'this branch'}
          </span>
          {loading ? <span style={{ color: 'var(--ink-muted)' }}>Loading…</span> : null}
        </div>

        <div className="line-items">
          <div className="line-items__scroll" style={{ borderRadius: 14 }}>
            <table className="line-items__table">
              <thead>
                <tr>
                  <th style={{ width: '22%' }}>Product</th>
                  <th style={{ width: 190 }}>Discount</th>
                  <th>UoM</th>
                  <th>Price level</th>
                  <th className="num">Global price</th>
                  <th className="num" style={{ width: 160 }}>
                    Branch price
                  </th>
                  <th className="num">Effective</th>
                  <th style={{ width: 120 }} />
                </tr>
              </thead>
              <tbody>
                {visible.length === 0 ? (
                  <tr>
                    <td colSpan={8} style={{ textAlign: 'center', color: 'var(--ink-muted)', padding: '1.5rem' }}>
                      {loading
                        ? 'Loading…'
                        : filter === 'overridden'
                          ? 'No branch overrides or discounts yet.'
                          : 'No products with selling prices.'}
                    </td>
                  </tr>
                ) : (
                  visible.flatMap((p) =>
                    p.prices.map((row, i) => {
                      const overridden = row.branch_unit_price != null;
                      const busy = savingId === row.selling_price_id;
                      return (
                        <tr key={row.selling_price_id} className={overridden ? 'branch-pricing__overridden' : ''}>
                          {i === 0 ? (
                            <td rowSpan={p.prices.length} style={{ verticalAlign: 'top', fontWeight: 600 }}>
                              {p.name}
                              {p.sku ? (
                                <div style={{ color: 'var(--ink-muted)', fontWeight: 400, fontSize: '0.8rem' }}>
                                  {p.sku}
                                </div>
                              ) : null}
                            </td>
                          ) : null}
                          {i === 0 ? (
                            <td rowSpan={p.prices.length} style={{ verticalAlign: 'top' }}>
                              <div className="branch-pricing__discount">
                                <div className="branch-pricing__pct">
                                  <input
                                    type="number"
                                    min="0.01"
                                    max="99.99"
                                    step="any"
                                    value={discountDraftValue(p)}
                                    placeholder="0"
                                    readOnly={!canEdit}
                                    onChange={(e) =>
                                      setDiscountDrafts((d) => ({ ...d, [p.id]: e.target.value }))
                                    }
                                    onKeyDown={(e) => {
                                      if (e.key === 'Enter' && isDiscountDirty(p)) {
                                        e.preventDefault();
                                        void saveDiscount(p);
                                      }
                                    }}
                                  />
                                  <span>%</span>
                                </div>
                                {canEdit ? (
                                  <>
                                    <button
                                      type="button"
                                      className="line-items__remove branch-pricing__save"
                                      title="Save discount"
                                      aria-label="Save discount"
                                      disabled={!isDiscountDirty(p) || savingId === p.id}
                                      onClick={() => void saveDiscount(p)}
                                    >
                                      <Save size={16} />
                                    </button>
                                    <button
                                      type="button"
                                      className="line-items__remove"
                                      title="Remove discount"
                                      aria-label="Remove discount"
                                      disabled={p.discount_percent == null || savingId === p.id}
                                      onClick={() => void clearDiscount(p)}
                                    >
                                      <RotateCcw size={16} />
                                    </button>
                                  </>
                                ) : null}
                              </div>
                            </td>
                          ) : null}
                          <td>
                            {row.uom.code}
                            <span style={{ color: 'var(--ink-muted)' }}> — {row.uom.name}</span>
                          </td>
                          <td style={{ textTransform: 'capitalize' }}>
                            {row.price_level}
                            {row.label ? ` (${row.label})` : ''}
                          </td>
                          <td className="num" style={overridden ? { color: 'var(--ink-muted)', textDecoration: 'line-through' } : undefined}>
                            {money(row.global_unit_price)}
                          </td>
                          <td>
                            <input
                              type="number"
                              min="0"
                              step="any"
                              value={draftValue(row)}
                              placeholder={money(row.global_unit_price)}
                              readOnly={!canEdit}
                              onChange={(e) =>
                                setDrafts((d) => ({ ...d, [row.selling_price_id]: e.target.value }))
                              }
                              onKeyDown={(e) => {
                                if (e.key === 'Enter' && isDirty(row)) {
                                  e.preventDefault();
                                  void save(row);
                                }
                              }}
                            />
                          </td>
                          <td className="num line-items__subtotal">
                            {p.discount_percent != null ? (
                              <div className="branch-pricing__was">{money(row.pre_discount_unit_price)}</div>
                            ) : null}
                            {money(row.effective_unit_price)}
                            {overridden ? <span className="branch-pricing__badge">Branch</span> : null}
                            {p.discount_percent != null ? (
                              <span className="branch-pricing__badge branch-pricing__badge--discount">
                                −{Number(p.discount_percent)}%
                              </span>
                            ) : null}
                          </td>
                          <td style={{ whiteSpace: 'nowrap', textAlign: 'right' }}>
                            {canEdit ? (
                              <>
                                <button
                                  type="button"
                                  className="line-items__remove branch-pricing__save"
                                  title="Save branch price"
                                  aria-label="Save branch price"
                                  disabled={!isDirty(row) || busy}
                                  onClick={() => void save(row)}
                                >
                                  <Save size={16} />
                                </button>
                                <button
                                  type="button"
                                  className="line-items__remove"
                                  title="Use global price"
                                  aria-label="Use global price"
                                  disabled={!overridden || busy}
                                  onClick={() => void reset(p, row)}
                                >
                                  <RotateCcw size={16} />
                                </button>
                              </>
                            ) : null}
                          </td>
                        </tr>
                      );
                    })
                  )
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
};
