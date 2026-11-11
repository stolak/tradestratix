import React, { useEffect, useMemo, useState } from 'react';
import { api } from '../utils/api';
import { alertError, alertSuccess, confirmAction } from '../utils/alerts';

type ConversionRow = { key: string; from_uom_id: string; factor: string };
type SellingRow = {
  key: string;
  uom_id: string;
  unit_price: string;
  price_level: string;
  label: string;
  is_default: boolean;
};

const PRICE_LEVELS = [
  { value: 'retail', label: 'Retail' },
  { value: 'wholesale', label: 'Wholesale' },
  { value: 'distributor', label: 'Distributor' },
  { value: 'special', label: 'Special' },
  { value: 'custom', label: 'Custom' }
];

const TRACKING_OPTIONS = [
  {
    key: 'track_expiry' as const,
    label: 'Expiry date',
    desc: 'Require and prioritise expiry (FEFO) on receive and issue.'
  },
  {
    key: 'track_batch' as const,
    label: 'Batch number',
    desc: 'Keep distinct lots with batch identity and costs.'
  },
  {
    key: 'track_serial' as const,
    label: 'Serial number',
    desc: 'Track individual serialized units where required.'
  },
  {
    key: 'track_weight' as const,
    label: 'Weight-based',
    desc: 'Measure and sell by weight rather than discrete count alone.'
  },
  {
    key: 'track_length' as const,
    label: 'Length-based',
    desc: 'Measure fabrics, cables and similar by length.'
  },
  {
    key: 'has_variants' as const,
    label: 'Size / colour variants',
    desc: 'Maintain independent SKUs and stock per variation.'
  }
];

const emptyForm = {
  name: '',
  sku: '',
  base_uom_id: '',
  purchase_uom_id: '',
  category_id: '',
  default_purchase_cost: '0',
  reorder_level: '0',
  track_expiry: false,
  track_batch: false,
  track_serial: false,
  track_weight: false,
  track_length: false,
  has_variants: false
};

function sectionTitle(step: number, title: string, hint: string) {
  return (
    <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
      <div
        style={{
          width: 28,
          height: 28,
          borderRadius: 999,
          background: 'var(--brand)',
          color: 'white',
          display: 'grid',
          placeItems: 'center',
          fontSize: 13,
          fontWeight: 700,
          flexShrink: 0
        }}
      >
        {step}
      </div>
      <div>
        <div style={{ fontWeight: 700 }}>{title}</div>
        <div style={{ color: 'var(--ink-muted)', fontSize: '0.86rem', marginTop: 2 }}>{hint}</div>
      </div>
    </div>
  );
}

export const ProductsPage: React.FC = () => {
  const [rows, setRows] = useState<any[]>([]);
  const [uoms, setUoms] = useState<any[]>([]);
  const [categories, setCategories] = useState<any[]>([]);
  const [q, setQ] = useState('');
  const [form, setForm] = useState(emptyForm);
  const [conversions, setConversions] = useState<ConversionRow[]>([]);
  const [sellingRows, setSellingRows] = useState<SellingRow[]>([]);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [baseUomLocked, setBaseUomLocked] = useState(false);

  const baseUom = useMemo(
    () => uoms.find((u) => u.id === form.base_uom_id),
    [uoms, form.base_uom_id]
  );

  const packagingUoms = useMemo(
    () => uoms.filter((u) => u.id !== form.base_uom_id),
    [uoms, form.base_uom_id]
  );

  /** Units available for purchase/selling = base + defined packaging conversions */
  const configuredUnits = useMemo(() => {
    const ids = [form.base_uom_id, ...conversions.map((c) => c.from_uom_id)].filter(Boolean);
    const unique = [...new Set(ids)];
    return unique
      .map((id) => uoms.find((u) => u.id === id))
      .filter(Boolean) as { id: string; code: string; name: string }[];
  }, [form.base_uom_id, conversions, uoms]);

  const load = async () => {
    try {
      const [products, units, cats] = await Promise.all([
        api.products.list(q || undefined),
        api.uoms.list(),
        api.products.categories()
      ]);
      setRows(products);
      setUoms(units);
      setCategories(cats);
      if (!form.base_uom_id && units[0]) {
        const pcs = units.find((u: any) => u.code === 'PCS') || units[0];
        setForm((f) => ({
          ...f,
          base_uom_id: pcs.id,
          purchase_uom_id: pcs.id
        }));
        setSellingRows([
          {
            key: 'default-sell',
            uom_id: pcs.id,
            unit_price: '0',
            price_level: 'retail',
            label: '',
            is_default: true
          }
        ]);
      }
    } catch (e: any) {
      await alertError('Products', e.message);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  /** Keep purchase/selling selections inside configured units when conversions change */
  useEffect(() => {
    const allowed = new Set(configuredUnits.map((u) => u.id));
    if (form.purchase_uom_id && !allowed.has(form.purchase_uom_id)) {
      setForm((f) => ({ ...f, purchase_uom_id: form.base_uom_id }));
    }
    setSellingRows((rows) => {
      const next = rows
        .map((r) =>
          allowed.has(r.uom_id) ? r : { ...r, uom_id: form.base_uom_id || r.uom_id }
        )
        .filter((r) => r.uom_id);
      if (!next.length && form.base_uom_id) {
        return [
          {
            key: 'default-sell',
            uom_id: form.base_uom_id,
            unit_price: '0',
            price_level: 'retail',
            label: '',
            is_default: true
          }
        ];
      }
      if (next.length && !next.some((r) => r.is_default)) {
        next[0] = { ...next[0], is_default: true };
      }
      return next;
    });
  }, [configuredUnits.map((u) => u.id).join('|'), form.base_uom_id]);

  const setBaseUom = (baseId: string) => {
    setForm((f) => ({
      ...f,
      base_uom_id: baseId,
      purchase_uom_id: baseId
    }));
    setConversions((rows) => rows.filter((c) => c.from_uom_id !== baseId));
    setSellingRows((rows) =>
      rows.length
        ? rows.map((r, i) => ({
            ...r,
            uom_id: baseId,
            is_default: i === 0
          }))
        : [
            {
              key: 'default-sell',
              uom_id: baseId,
              unit_price: '0',
              price_level: 'retail',
              label: '',
              is_default: true
            }
          ]
    );
  };

  const addConversionRow = () => {
    const used = new Set(conversions.map((c) => c.from_uom_id));
    const next = packagingUoms.find((u) => !used.has(u.id));
    if (!next) {
      void alertError(
        'No more units',
        'Add more units under Units, then return here to map packaging.'
      );
      return;
    }
    setConversions((rows) => [
      ...rows,
      { key: `${Date.now()}-${next.id}`, from_uom_id: next.id, factor: '' }
    ]);
  };

  const addSellingRow = () => {
    if (!configuredUnits.length) {
      void alertError('Define base UoM first');
      return;
    }
    const preferred =
      configuredUnits.find((u) => !sellingRows.some((s) => s.uom_id === u.id)) ||
      configuredUnits[0];
    setSellingRows((rows) => [
      ...rows,
      {
        key: `sell-${Date.now()}`,
        uom_id: preferred.id,
        unit_price: '',
        price_level: 'retail',
        label: '',
        is_default: rows.length === 0
      }
    ]);
  };

  const resetForm = (keepBase = true) => {
    const base = keepBase ? form.base_uom_id : '';
    setEditingId(null);
    setBaseUomLocked(false);
    setForm({
      ...emptyForm,
      base_uom_id: base,
      purchase_uom_id: base
    });
    setConversions([]);
    setSellingRows(
      base
        ? [
            {
              key: 'default-sell',
              uom_id: base,
              unit_price: '0',
              price_level: 'retail',
              label: '',
              is_default: true
            }
          ]
        : []
    );
  };

  const startEdit = (p: any) => {
    setEditingId(p.id);
    setBaseUomLocked(!p.can_delete);
    setExpandedId(null);
    setForm({
      name: p.name || '',
      sku: p.sku || '',
      base_uom_id: p.base_uom_id || p.base_uom?.id || '',
      purchase_uom_id: p.purchase_uom_id || p.purchase_uom?.id || p.base_uom_id || '',
      category_id: p.category_id || '',
      default_purchase_cost: String(p.default_purchase_cost ?? 0),
      reorder_level: String(p.reorder_level ?? 0),
      track_expiry: Boolean(p.track_expiry),
      track_batch: Boolean(p.track_batch),
      track_serial: Boolean(p.track_serial),
      track_weight: Boolean(p.track_weight),
      track_length: Boolean(p.track_length),
      has_variants: Boolean(p.has_variants)
    });
    setConversions(
      (p.conversions || []).map((c: any) => ({
        key: c.id || `${c.from_uom_id}-${c.factor}`,
        from_uom_id: c.from_uom_id || c.from_uom?.id || '',
        factor: String(c.factor ?? '')
      }))
    );
    const prices = p.selling_prices || [];
    setSellingRows(
      prices.length
        ? prices.map((s: any, i: number) => ({
            key: s.id || `sell-${i}`,
            uom_id: s.uom_id || s.uom?.id || '',
            unit_price: String(s.unit_price ?? 0),
            price_level: s.price_level || 'retail',
            label: s.label || '',
            is_default: Boolean(s.is_default)
          }))
        : [
            {
              key: 'default-sell',
              uom_id: p.selling_uom_id || p.base_uom_id || '',
              unit_price: String(p.default_selling_price ?? 0),
              price_level: 'retail',
              label: '',
              is_default: true
            }
          ]
    );
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const removeProduct = async (p: any) => {
    if (!p.can_delete) {
      await alertError(
        'Cannot delete',
        'This product has already been transacted. Deactivate it instead of deleting.'
      );
      return;
    }
    const ok = await confirmAction(
      'Delete product?',
      `"${p.name}" has no stock history and will be permanently removed.`
    );
    if (!ok) return;
    try {
      await api.products.remove(p.id);
      await alertSuccess('Product deleted');
      if (editingId === p.id) resetForm();
      await load();
    } catch (err: any) {
      await alertError('Delete failed', err.message);
    }
  };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.base_uom_id) {
      await alertError('Base UoM required');
      return;
    }

    const parsedConversions: { from_uom_id: string; to_uom_id: string; factor: number }[] = [];
    const seenPack = new Set<string>();
    for (const row of conversions) {
      if (!row.from_uom_id) continue;
      const factor = Number(row.factor);
      if (!factor || factor <= 0) {
        await alertError('Invalid factor', 'Each packaging conversion needs a factor greater than 0.');
        return;
      }
      if (seenPack.has(row.from_uom_id)) {
        await alertError('Duplicate packaging unit');
        return;
      }
      seenPack.add(row.from_uom_id);
      parsedConversions.push({
        from_uom_id: row.from_uom_id,
        to_uom_id: form.base_uom_id,
        factor
      });
    }

    const allowed = new Set([form.base_uom_id, ...parsedConversions.map((c) => c.from_uom_id)]);
    if (!allowed.has(form.purchase_uom_id)) {
      await alertError(
        'Invalid purchase unit',
        'Choose purchase UoM from the base unit or a packaging conversion you defined above.'
      );
      return;
    }

    if (!sellingRows.length) {
      await alertError('Add at least one selling unit and price');
      return;
    }

    const selling_prices = [];
    for (const row of sellingRows) {
      if (!allowed.has(row.uom_id)) {
        await alertError(
          'Invalid selling unit',
          'Selling units must come from the base UoM or defined packaging conversions.'
        );
        return;
      }
      const price = Number(row.unit_price);
      if (Number.isNaN(price) || price < 0) {
        await alertError('Invalid selling price', 'Enter a valid price for each selling unit.');
        return;
      }
      selling_prices.push({
        uom_id: row.uom_id,
        unit_price: price,
        price_level: row.price_level,
        label: row.label || undefined,
        is_default: row.is_default
      });
    }

    if (!selling_prices.some((s) => s.is_default)) {
      selling_prices[0].is_default = true;
    }

    const payload = {
      name: form.name,
      sku: form.sku || undefined,
      track_expiry: form.track_expiry,
      track_batch: form.track_batch,
      track_serial: form.track_serial,
      track_weight: form.track_weight,
      track_length: form.track_length,
      has_variants: form.has_variants,
      base_uom_id: form.base_uom_id,
      purchase_uom_id: form.purchase_uom_id || form.base_uom_id,
      category_id: form.category_id || undefined,
      default_purchase_cost: Number(form.default_purchase_cost),
      reorder_level: Number(form.reorder_level),
      conversions: parsedConversions,
      selling_prices
    };

    try {
      if (editingId) {
        await api.products.update(editingId, payload);
        await alertSuccess('Product updated');
      } else {
        await api.products.create(payload);
        await alertSuccess('Product created');
      }
      resetForm();
      await load();
    } catch (err: any) {
      await alertError(editingId ? 'Update failed' : 'Create failed', err.message);
    }
  };

  return (
    <div className="page-stack">
      <header style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <h1 className="display" style={{ margin: 0, fontSize: '2.2rem' }}>
            Products
          </h1>
          <p style={{ color: 'var(--ink-muted)', margin: '0.35rem 0 0' }}>
            Define packaging first, then choose purchase and selling units from those conversions.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'end' }}>
          <div className="field">
            <label>Search</label>
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name / SKU" />
          </div>
          <button type="button" className="btn btn-ghost" onClick={() => void load()}>
            Search
          </button>
        </div>
      </header>

      <form
        onSubmit={save}
        className="card-surface"
        style={{ padding: '1.25rem', display: 'grid', gap: 18 }}
      >
        {editingId ? (
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              gap: 12,
              padding: '0.65rem 0.85rem',
              borderRadius: 12,
              background: 'rgba(15,92,76,0.08)',
              border: '1px solid var(--line)'
            }}
          >
            <div style={{ fontWeight: 600 }}>Editing product</div>
            <button type="button" className="btn btn-ghost" onClick={() => resetForm()}>
              Cancel edit
            </button>
          </div>
        ) : null}

        {/* Identity */}
        <div style={{ display: 'grid', gap: 12 }}>
          {sectionTitle(1, 'Product details', 'Basic identity and stock policy for this item.')}
          <div className="products-grid-4">
            <div className="field">
              <label>Name</label>
              <input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                required
              />
            </div>
            <div className="field">
              <label>SKU</label>
              <input value={form.sku} onChange={(e) => setForm({ ...form, sku: e.target.value })} />
            </div>
            <div className="field">
              <label>Category</label>
              <select
                value={form.category_id}
                onChange={(e) => setForm({ ...form, category_id: e.target.value })}
              >
                <option value="">—</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label>Reorder level (base units)</label>
              <input
                type="number"
                value={form.reorder_level}
                onChange={(e) => setForm({ ...form, reorder_level: e.target.value })}
              />
            </div>
          </div>

          <div style={{ display: 'grid', gap: 8, marginTop: 4 }}>
            <div style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--ink-muted)' }}>
              Tracking requirements — select every mode this product needs
            </div>
            <div className="products-track">
              {TRACKING_OPTIONS.map((opt) => {
                const on = Boolean(form[opt.key]);
                return (
                  <label
                    key={opt.key}
                    className={`products-track__option${on ? ' is-on' : ''}`}
                  >
                    <input
                      type="checkbox"
                      checked={on}
                      onChange={(e) => setForm({ ...form, [opt.key]: e.target.checked })}
                    />
                    <span>
                      <div className="products-track__label">{opt.label}</div>
                      <div className="products-track__desc">{opt.desc}</div>
                    </span>
                  </label>
                );
              })}
            </div>
          </div>
        </div>

        {/* Base UoM */}
        <div
          style={{
            borderTop: '1px solid var(--line)',
            paddingTop: 16,
            display: 'grid',
            gap: 12
          }}
        >
          {sectionTitle(
            2,
            'Base unit of measure',
            'Inventory is always stored in this unit. Packaging units convert into it.'
          )}
          <div style={{ maxWidth: 360 }}>
            <div className="field">
              <label>Base UoM</label>
              <select
                value={form.base_uom_id}
                onChange={(e) => setBaseUom(e.target.value)}
                required
                disabled={baseUomLocked}
              >
                {uoms.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.code} — {u.name}
                  </option>
                ))}
              </select>
              {baseUomLocked ? (
                <div style={{ fontSize: '0.8rem', color: 'var(--ink-muted)', marginTop: 4 }}>
                  Base UoM is locked because this product already has stock history.
                </div>
              ) : null}
            </div>
          </div>
        </div>

        {/* Packaging conversions — BEFORE purchase/selling */}
        <div
          style={{
            borderTop: '1px solid var(--line)',
            paddingTop: 16,
            display: 'grid',
            gap: 12
          }}
        >
          {sectionTitle(
            3,
            'Packaging conversions',
            `Map packs, cartons, etc. Example: 1 Pack = 5 ${baseUom?.code || 'PCS'}, 1 Carton = 15 ${baseUom?.code || 'PCS'}.`
          )}

          <div
            style={{
              background: 'rgba(15, 92, 76, 0.04)',
              border: '1px solid var(--line)',
              borderRadius: 14,
              padding: '1rem',
              display: 'grid',
              gap: 10
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: '0.88rem', color: 'var(--ink-muted)' }}>
                Optional — skip if you only trade in the base unit.
              </span>
              <button type="button" className="btn btn-ghost" onClick={addConversionRow}>
                + Add packaging unit
              </button>
            </div>

            {!conversions.length ? (
              <div
                style={{
                  padding: '0.85rem 1rem',
                  borderRadius: 10,
                  border: '1px dashed var(--line)',
                  color: 'var(--ink-muted)',
                  fontSize: '0.9rem'
                }}
              >
                No packaging yet. Add units such as Pack or Carton after choosing the base UoM.
              </div>
            ) : (
              conversions.map((row) => {
                const from = uoms.find((u) => u.id === row.from_uom_id);
                return (
                  <div key={row.key} className="form-grid">
                    <div className="field">
                      <label>Packaging UoM</label>
                      <select
                        value={row.from_uom_id}
                        onChange={(e) =>
                          setConversions((rows) =>
                            rows.map((r) =>
                              r.key === row.key ? { ...r, from_uom_id: e.target.value } : r
                            )
                          )
                        }
                      >
                        {packagingUoms.map((u) => (
                          <option key={u.id} value={u.id}>
                            {u.code} — {u.name}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div style={{ paddingBottom: 10, color: 'var(--ink-muted)' }}>=</div>
                    <div className="field">
                      <label>Contains</label>
                      <input
                        type="number"
                        min="0.000001"
                        step="any"
                        placeholder="e.g. 5"
                        value={row.factor}
                        onChange={(e) =>
                          setConversions((rows) =>
                            rows.map((r) =>
                              r.key === row.key ? { ...r, factor: e.target.value } : r
                            )
                          )
                        }
                        required
                      />
                    </div>
                    <div style={{ paddingBottom: 10, fontWeight: 700 }}>
                      {baseUom?.code || 'base'}
                    </div>
                    <div style={{ paddingBottom: 10, color: 'var(--ink-muted)', fontSize: '0.85rem' }}>
                      1 {from?.code || '?'} = {row.factor || '…'} {baseUom?.code || 'base'}
                    </div>
                    <div className="form-grid--actions">
                      <button
                        type="button"
                        className="btn btn-ghost"
                        onClick={() =>
                          setConversions((rows) => rows.filter((r) => r.key !== row.key))
                        }
                      >
                        Remove
                      </button>
                    </div>
                  </div>
                );
              })
            )}

            {configuredUnits.length > 0 ? (
              <div
                style={{
                  marginTop: 4,
                  fontSize: '0.82rem',
                  color: 'var(--brand-deep)',
                  fontWeight: 600
                }}
              >
                Available for purchase/selling:{' '}
                {configuredUnits.map((u) => u.code).join(' · ')}
              </div>
            ) : null}
          </div>
        </div>

        {/* Purchase — after conversions */}
        <div
          style={{
            borderTop: '1px solid var(--line)',
            paddingTop: 16,
            display: 'grid',
            gap: 12
          }}
        >
          {sectionTitle(
            4,
            'Purchase unit',
            'Select how you normally buy this item. Choices are limited to the units defined above.'
          )}
          <div className="products-grid-2">
            <div className="field">
              <label>Purchase UoM</label>
              <select
                value={form.purchase_uom_id}
                onChange={(e) => setForm({ ...form, purchase_uom_id: e.target.value })}
                required
              >
                {configuredUnits.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.code} — {u.name}
                    {u.id === form.base_uom_id ? ' (base)' : ''}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label>Default purchase cost (per purchase UoM)</label>
              <input
                type="number"
                min="0"
                step="any"
                value={form.default_purchase_cost}
                onChange={(e) => setForm({ ...form, default_purchase_cost: e.target.value })}
              />
            </div>
          </div>
        </div>

        {/* Selling — multiple UoMs & prices from configured units only */}
        <div
          style={{
            borderTop: '1px solid var(--line)',
            paddingTop: 16,
            display: 'grid',
            gap: 12
          }}
        >
          {sectionTitle(
            5,
            'Selling units & prices',
            'Add every unit you sell in. Each selling UoM must be the base unit or a packaging conversion.'
          )}

          <div
            className="products-price-editor"
            style={{
              border: '1px solid var(--line)',
              borderRadius: 14,
              overflow: 'hidden'
            }}
          >
            <div
              className="products-price-editor__row"
              style={{
                padding: '0.65rem 1rem',
                background: 'rgba(26,35,50,0.04)',
                fontSize: '0.75rem',
                fontWeight: 700,
                letterSpacing: '0.04em',
                textTransform: 'uppercase',
                color: 'var(--ink-muted)'
              }}
            >
              <span>Selling UoM</span>
              <span>Price level</span>
              <span>Label (optional)</span>
              <span>Unit price</span>
              <span>Default</span>
              <span />
            </div>

            {sellingRows.map((row) => (
              <div
                key={row.key}
                className="products-price-editor__row"
                style={{
                  padding: '0.75rem 1rem',
                  borderTop: '1px solid var(--line)'
                }}
              >
                <select
                  value={row.uom_id}
                  onChange={(e) =>
                    setSellingRows((rows) =>
                      rows.map((r) => (r.key === row.key ? { ...r, uom_id: e.target.value } : r))
                    )
                  }
                  required
                >
                  {configuredUnits.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.code} — {u.name}
                    </option>
                  ))}
                </select>
                <select
                  value={row.price_level}
                  onChange={(e) =>
                    setSellingRows((rows) =>
                      rows.map((r) =>
                        r.key === row.key ? { ...r, price_level: e.target.value } : r
                      )
                    )
                  }
                >
                  {PRICE_LEVELS.map((p) => (
                    <option key={p.value} value={p.value}>
                      {p.label}
                    </option>
                  ))}
                </select>
                <input
                  placeholder="e.g. Counter price"
                  value={row.label}
                  onChange={(e) =>
                    setSellingRows((rows) =>
                      rows.map((r) => (r.key === row.key ? { ...r, label: e.target.value } : r))
                    )
                  }
                />
                <input
                  type="number"
                  min="0"
                  step="any"
                  placeholder="0.00"
                  value={row.unit_price}
                  onChange={(e) =>
                    setSellingRows((rows) =>
                      rows.map((r) =>
                        r.key === row.key ? { ...r, unit_price: e.target.value } : r
                      )
                    )
                  }
                  required
                />
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.85rem' }}>
                  <input
                    type="radio"
                    name="default_sell"
                    checked={row.is_default}
                    onChange={() =>
                      setSellingRows((rows) =>
                        rows.map((r) => ({ ...r, is_default: r.key === row.key }))
                      )
                    }
                  />
                  Default
                </label>
                <button
                  type="button"
                  className="btn btn-ghost"
                  disabled={sellingRows.length <= 1}
                  onClick={() =>
                    setSellingRows((rows) => {
                      const next = rows.filter((r) => r.key !== row.key);
                      if (next.length && !next.some((r) => r.is_default)) {
                        next[0] = { ...next[0], is_default: true };
                      }
                      return next;
                    })
                  }
                >
                  Remove
                </button>
              </div>
            ))}
          </div>

          <button
            type="button"
            className="btn btn-ghost"
            onClick={addSellingRow}
            style={{ justifySelf: 'start' }}
          >
            + Add selling unit / price
          </button>
        </div>

        <div className="form-grid--actions">
          <button className="btn btn-primary" type="submit">
            {editingId ? 'Save changes' : 'Create product'}
          </button>
          {editingId ? (
            <button type="button" className="btn btn-ghost" onClick={() => resetForm()}>
              Cancel
            </button>
          ) : null}
        </div>
      </form>

      <div className="card-surface" style={{ padding: '0.5rem 0' }}>
        <div className="table-wrap">
          <table className="table">
          <thead>
            <tr>
              <th>SKU</th>
              <th>Name</th>
              <th>Tracking</th>
              <th>Base</th>
              <th>Purchase</th>
              <th>Selling prices</th>
              <th>Conversions</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((p) => (
              <React.Fragment key={p.id}>
                <tr
                  style={{
                    cursor: 'pointer',
                    background: editingId === p.id ? 'rgba(15,92,76,0.06)' : undefined
                  }}
                  onClick={() => setExpandedId(expandedId === p.id ? null : p.id)}
                >
                  <td>{p.sku || '—'}</td>
                  <td>{p.name}</td>
                  <td>
                    {[
                      p.track_expiry && 'Expiry',
                      p.track_batch && 'Batch',
                      p.track_serial && 'Serial',
                      p.track_weight && 'Weight',
                      p.track_length && 'Length',
                      p.has_variants && 'Variants'
                    ]
                      .filter(Boolean)
                      .join(' · ') || 'Standard'}
                  </td>
                  <td>{p.base_uom?.code || '—'}</td>
                  <td>{p.purchase_uom?.code || p.base_uom?.code}</td>
                  <td>
                    {(p.selling_prices || [])
                      .map(
                        (s: any) =>
                          `${s.uom?.code} ${Number(s.unit_price).toLocaleString()}${s.is_default ? '*' : ''}`
                      )
                      .join(' · ') || `${p.selling_uom?.code || p.base_uom?.code} ${p.default_selling_price}`}
                  </td>
                  <td>
                    {(p.conversions || [])
                      .map((c: any) => `1 ${c.from_uom?.code}=${c.factor} ${p.base_uom?.code}`)
                      .join(' · ') || 'Base only'}
                  </td>
                  <td onClick={(e) => e.stopPropagation()}>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      <button
                        type="button"
                        className="btn btn-ghost"
                        onClick={() => startEdit(p)}
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        className="btn btn-ghost"
                        disabled={!p.can_delete}
                        title={
                          p.can_delete
                            ? 'Delete product'
                            : 'Already transacted — delete not allowed'
                        }
                        onClick={() => void removeProduct(p)}
                      >
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
                {expandedId === p.id ? (
                  <tr>
                    <td colSpan={8} style={{ background: 'rgba(15,92,76,0.03)' }}>
                      <div className="split-2" style={{ padding: '0.75rem 0.85rem' }}>
                        <div>
                          <strong>Packaging</strong>
                          <div style={{ marginTop: 6, fontSize: '0.9rem' }}>
                            {(p.conversions || []).length
                              ? (p.conversions || []).map((c: any) => (
                                  <div key={c.id}>
                                    1 {c.from_uom?.code} = {c.factor} {p.base_uom?.code}
                                  </div>
                                ))
                              : 'Base unit only'}
                          </div>
                        </div>
                        <div>
                          <strong>Selling prices</strong>
                          <div style={{ marginTop: 6, fontSize: '0.9rem' }}>
                            {(p.selling_prices || []).length
                              ? (p.selling_prices || []).map((s: any) => (
                                  <div key={s.id}>
                                    {s.uom?.code} · {s.price_level}
                                    {s.label ? ` · ${s.label}` : ''}:{' '}
                                    {Number(s.unit_price).toLocaleString()}
                                    {s.is_default ? ' (default)' : ''}
                                  </div>
                                ))
                              : '—'}
                          </div>
                        </div>
                      </div>
                    </td>
                  </tr>
                ) : null}
              </React.Fragment>
            ))}
          </tbody>
        </table>
        </div>
      </div>
    </div>
  );
};
