import React, { useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, Download, Info } from 'lucide-react';
import { api } from '../utils/api';
import { alertError } from '../utils/alerts';
import { MultiSelect } from './MultiSelect';

type View = 'product' | 'warehouse' | 'detail';

type Row = {
  product_id: string;
  product_name: string;
  product_sku: string | null;
  variant_id: string;
  variant_name: string | null;
  variant_sku: string | null;
  category: string | null;
  uom: string | null;
  reorder_level: number;
  warehouse_id: string;
  warehouse_code: string;
  warehouse_name: string;
  branch_id: string;
  branch_name: string;
  lots: number;
  on_hand: number;
  reserved: number;
  available: number;
  in_transit: number;
  expired_qty: number;
  stock_value: number;
  avg_cost: number | null;
};

type ProductGroup = {
  key: string;
  name: string;
  sku: string | null;
  category: string | null;
  uom: string | null;
  reorder_level: number;
  on_hand: number;
  reserved: number;
  available: number;
  in_transit: number;
  expired_qty: number;
  stock_value: number;
  rows: Row[];
};

function qty(v: number) {
  return Number(v || 0).toLocaleString(undefined, { maximumFractionDigits: 4 });
}

function money(v: unknown) {
  return Number(v || 0).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

function productLabel(r: { product_name: string; variant_name: string | null }) {
  return r.variant_name ? `${r.product_name} — ${r.variant_name}` : r.product_name;
}

function downloadCsv(filename: string, header: string[], lines: (string | number | null)[][]) {
  const esc = (v: string | number | null) => {
    const s = v == null ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = [header, ...lines].map((l) => l.map(esc).join(',')).join('\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export const StockBalanceReport: React.FC = () => {
  const [branchIds, setBranchIds] = useState<string[]>([]);
  const [warehouseIds, setWarehouseIds] = useState<string[]>([]);
  const [q, setQ] = useState('');
  const [includeZero, setIncludeZero] = useState(false);
  const [view, setView] = useState<View>('product');
  const [lowOnly, setLowOnly] = useState(false);
  const [data, setData] = useState<any | null>(null);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const run = async (opts?: { branchIds?: string[]; warehouseIds?: string[] }) => {
    setLoading(true);
    try {
      setData(
        await api.reports.stockBalance({
          branch_ids: opts?.branchIds ?? branchIds,
          warehouse_ids: opts?.warehouseIds ?? warehouseIds,
          q: q.trim() || undefined,
          include_zero: includeZero
        })
      );
      setExpanded(new Set());
    } catch (e: any) {
      await alertError('Stock balance', e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void run();
  }, []);

  const branches: any[] = data?.options?.branches || [];
  const allWarehouses: any[] = data?.options?.warehouses || [];
  const branchName = useMemo(
    () => new Map(branches.map((b) => [b.id, b.code ? `${b.code} — ${b.name}` : b.name])),
    [branches]
  );

  const branchOptions = branches.map((b) => ({
    value: b.id,
    label: b.code ? `${b.code} — ${b.name}` : b.name,
    muted: b.is_active === false
  }));
  const warehouseOptions = allWarehouses
    .filter((w) => !branchIds.length || branchIds.includes(w.branch_id))
    .map((w) => ({
      value: w.id,
      label: `${w.code} — ${w.name}`,
      group: branchName.get(w.branch_id),
      muted: w.is_active === false
    }));

  const changeBranches = (next: string[]) => {
    setBranchIds(next);
    if (next.length) {
      const allowed = new Set(allWarehouses.filter((w) => next.includes(w.branch_id)).map((w) => w.id));
      setWarehouseIds((ids) => ids.filter((id) => allowed.has(id)));
    }
  };

  const rows: Row[] = data?.rows || [];

  const products = useMemo(() => {
    const map = new Map<string, ProductGroup>();
    for (const r of rows) {
      const g =
        map.get(r.variant_id) ||
        ({
          key: r.variant_id,
          name: productLabel(r),
          sku: r.variant_sku || r.product_sku,
          category: r.category,
          uom: r.uom,
          reorder_level: r.reorder_level,
          on_hand: 0,
          reserved: 0,
          available: 0,
          in_transit: 0,
          expired_qty: 0,
          stock_value: 0,
          rows: []
        } as ProductGroup);
      g.on_hand += r.on_hand;
      g.reserved += r.reserved;
      g.available += r.available;
      g.in_transit += r.in_transit;
      g.expired_qty += r.expired_qty;
      g.stock_value += r.stock_value;
      g.rows.push(r);
      map.set(r.variant_id, g);
    }
    return [...map.values()];
  }, [rows]);

  const isLow = (g: { reorder_level: number; available: number }) =>
    g.reorder_level > 0 && g.available <= g.reorder_level;
  const lowCount = products.filter(isLow).length;
  const visibleProducts = lowOnly ? products.filter(isLow) : products;
  const lowVariantIds = new Set(products.filter(isLow).map((p) => p.key));

  const warehouses = useMemo(() => {
    const map = new Map<
      string,
      { id: string; label: string; branch: string; skus: number; on_hand: number; available: number; stock_value: number }
    >();
    for (const r of rows) {
      const w = map.get(r.warehouse_id) || {
        id: r.warehouse_id,
        label: `${r.warehouse_code} — ${r.warehouse_name}`,
        branch: r.branch_name,
        skus: 0,
        on_hand: 0,
        available: 0,
        stock_value: 0
      };
      if (r.on_hand > 0) w.skus += 1;
      w.on_hand += r.on_hand;
      w.available += r.available;
      w.stock_value += r.stock_value;
      map.set(r.warehouse_id, w);
    }
    return [...map.values()].sort((a, b) => a.branch.localeCompare(b.branch) || a.label.localeCompare(b.label));
  }, [rows]);

  const detailRows = lowOnly ? rows.filter((r) => lowVariantIds.has(r.variant_id)) : rows;

  const toggle = (key: string) =>
    setExpanded((s) => {
      const next = new Set(s);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const exportCsv = () => {
    const stamp = new Date().toISOString().slice(0, 10);
    if (view === 'warehouse') {
      downloadCsv(
        `stock-balance-by-warehouse-${stamp}.csv`,
        ['Branch', 'Warehouse', 'SKUs in stock', 'On hand', 'Available', 'Stock value'],
        warehouses.map((w) => [w.branch, w.label, w.skus, w.on_hand, w.available, w.stock_value])
      );
    } else if (view === 'product') {
      downloadCsv(
        `stock-balance-by-product-${stamp}.csv`,
        ['Product', 'SKU', 'Category', 'UoM', 'On hand', 'Reserved', 'Available', 'In transit', 'Expired', 'Reorder level', 'Stock value'],
        visibleProducts.map((p) => [
          p.name,
          p.sku,
          p.category,
          p.uom,
          p.on_hand,
          p.reserved,
          p.available,
          p.in_transit,
          p.expired_qty,
          p.reorder_level,
          Math.round(p.stock_value * 100) / 100
        ])
      );
    } else {
      downloadCsv(
        `stock-balance-detail-${stamp}.csv`,
        ['Product', 'SKU', 'Branch', 'Warehouse', 'UoM', 'Lots', 'On hand', 'Reserved', 'Available', 'In transit', 'Expired', 'Avg cost', 'Stock value'],
        detailRows.map((r) => [
          productLabel(r),
          r.variant_sku || r.product_sku,
          r.branch_name,
          `${r.warehouse_code} — ${r.warehouse_name}`,
          r.uom,
          r.lots,
          r.on_hand,
          r.reserved,
          r.available,
          r.in_transit,
          r.expired_qty,
          r.avg_cost,
          r.stock_value
        ])
      );
    }
  };

  const scopeLabel = `${
    branchIds.length ? `${branchIds.length} branch${branchIds.length > 1 ? 'es' : ''}` : 'All branches'
  } · ${
    warehouseIds.length
      ? `${warehouseIds.length} warehouse${warehouseIds.length > 1 ? 's' : ''}`
      : 'All warehouses'
  }`;

  return (
    <div className="page-stack" style={{ gap: '1rem' }}>
      <form
        className="card-surface cust-bal__filters"
        onSubmit={(e) => {
          e.preventDefault();
          void run();
        }}
      >
        <div className="field" style={{ minWidth: 220 }}>
          <label>Branch</label>
          <MultiSelect
            value={branchIds}
            options={branchOptions}
            onChange={changeBranches}
            allLabel="All branches"
            noun="branches"
          />
        </div>
        <div className="field" style={{ minWidth: 240 }}>
          <label>Warehouse</label>
          <MultiSelect
            value={warehouseIds}
            options={warehouseOptions}
            onChange={setWarehouseIds}
            allLabel={branchIds.length ? 'All warehouses in selected branches' : 'All warehouses'}
            noun="warehouses"
          />
        </div>
        <div className="field">
          <label>Product</label>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name / SKU" />
        </div>
        <label className="cust-bal__toggle" style={{ paddingBottom: '0.7rem' }}>
          <input type="checkbox" checked={includeZero} onChange={(e) => setIncludeZero(e.target.checked)} />
          Include zero stock
        </label>
        <button type="submit" className="btn btn-primary" disabled={loading}>
          {loading ? 'Running…' : 'Run report'}
        </button>
      </form>

      <div className="cust-bal__cards">
        <div className="card-surface cust-bal__card">
          <div className="cust-bal__card-label">Products</div>
          <div className="cust-bal__card-value">{data?.totals?.products ?? 0}</div>
          <div className="cust-bal__card-sub">{scopeLabel}</div>
        </div>
        <div className="card-surface cust-bal__card">
          <div className="cust-bal__card-label">Units on hand</div>
          <div className="cust-bal__card-value">{qty(data?.totals?.on_hand ?? 0)}</div>
          <div className="cust-bal__card-sub">
            Across {data?.totals?.warehouses ?? 0} warehouse{data?.totals?.warehouses === 1 ? '' : 's'} · mixed base UoMs
          </div>
        </div>
        <div className="card-surface cust-bal__card">
          <div className="cust-bal__card-label">
            Stock value
            <span className="info-tip" title="On-hand quantity × lot unit cost.">
              <Info size={13} />
            </span>
          </div>
          <div className="cust-bal__card-value">{money(data?.totals?.stock_value)}</div>
          <div className="cust-bal__card-sub">
            As of {data?.as_of ? new Date(data.as_of).toLocaleString() : '—'}
          </div>
        </div>
        <div className="card-surface cust-bal__card">
          <div className="cust-bal__card-label">At or below reorder level</div>
          <div className="cust-bal__card-value" style={lowCount ? { color: 'var(--danger)' } : undefined}>
            {lowCount}
          </div>
          <div className="cust-bal__card-sub">Available vs product reorder level</div>
        </div>
      </div>

      <div className="card-surface" style={{ padding: '0.5rem 0' }}>
        <div className="cust-bal__toolbar">
          <div className="segmented" role="tablist">
            {(
              [
                ['product', 'By product'],
                ['warehouse', 'By warehouse'],
                ['detail', 'Detail']
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                className={`segmented__btn${view === id ? ' is-active' : ''}`}
                onClick={() => setView(id)}
              >
                {label}
              </button>
            ))}
          </div>
          {view !== 'warehouse' ? (
            <label className="cust-bal__toggle">
              <input type="checkbox" checked={lowOnly} onChange={(e) => setLowOnly(e.target.checked)} />
              Low stock only
            </label>
          ) : null}
          <span className="cust-bal__count">
            {view === 'product'
              ? `${visibleProducts.length} products`
              : view === 'warehouse'
                ? `${warehouses.length} warehouses`
                : `${detailRows.length} rows`}
          </span>
          <button type="button" className="btn btn-ghost" onClick={exportCsv} disabled={!rows.length}>
            <Download size={15} /> CSV
          </button>
        </div>

        <div className="table-wrap">
          {view === 'product' ? (
            <table className="table">
              <thead>
                <tr>
                  <th style={{ width: 28 }} />
                  <th>Product</th>
                  <th>Category</th>
                  <th>UoM</th>
                  <th className="num">On hand</th>
                  <th className="num">Reserved</th>
                  <th className="num">Available</th>
                  <th className="num">In transit</th>
                  <th className="num">Stock value</th>
                </tr>
              </thead>
              <tbody>
                {visibleProducts.map((p) => {
                  const open = expanded.has(p.key);
                  const low = isLow(p);
                  return (
                    <React.Fragment key={p.key}>
                      <tr className={`cust-bal__row${open ? ' is-open' : ''}`} onClick={() => toggle(p.key)}>
                        <td className="cust-bal__chev">
                          {open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                        </td>
                        <td>
                          <div style={{ fontWeight: 600 }}>
                            {p.name}
                            {low ? <span className="stock-flag stock-flag--low">Low</span> : null}
                            {p.expired_qty > 0 ? (
                              <span className="stock-flag stock-flag--expired">{qty(p.expired_qty)} expired</span>
                            ) : null}
                          </div>
                          <div className="invoice-view__sub">
                            {[p.sku, `${p.rows.length} warehouse${p.rows.length > 1 ? 's' : ''}`]
                              .filter(Boolean)
                              .join(' · ')}
                          </div>
                        </td>
                        <td>{p.category || '—'}</td>
                        <td>{p.uom || '—'}</td>
                        <td className="num">{qty(p.on_hand)}</td>
                        <td className="num">{qty(p.reserved)}</td>
                        <td className={`num${low ? ' customer-terms__over' : ''}`}>
                          <strong>{qty(p.available)}</strong>
                          {p.reorder_level > 0 ? (
                            <div className="invoice-view__sub">reorder at {qty(p.reorder_level)}</div>
                          ) : null}
                        </td>
                        <td className="num">{qty(p.in_transit)}</td>
                        <td className="num">{money(p.stock_value)}</td>
                      </tr>
                      {open
                        ? p.rows.map((r) => (
                            <tr key={`${r.variant_id}:${r.warehouse_id}`} className="stock-sub-row">
                              <td />
                              <td colSpan={3}>
                                {r.warehouse_code} — {r.warehouse_name}
                                <span className="invoice-view__sub"> · {r.branch_name} · {r.lots} lot{r.lots === 1 ? '' : 's'}</span>
                              </td>
                              <td className="num">{qty(r.on_hand)}</td>
                              <td className="num">{qty(r.reserved)}</td>
                              <td className="num">{qty(r.available)}</td>
                              <td className="num">{qty(r.in_transit)}</td>
                              <td className="num">{money(r.stock_value)}</td>
                            </tr>
                          ))
                        : null}
                    </React.Fragment>
                  );
                })}
                {!visibleProducts.length ? (
                  <tr>
                    <td colSpan={9} style={{ color: 'var(--ink-muted)' }}>
                      {loading ? 'Loading…' : 'No stock for this selection.'}
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          ) : null}

          {view === 'warehouse' ? (
            <table className="table">
              <thead>
                <tr>
                  <th>Branch</th>
                  <th>Warehouse</th>
                  <th className="num">SKUs in stock</th>
                  <th className="num">On hand</th>
                  <th className="num">Available</th>
                  <th className="num">Stock value</th>
                </tr>
              </thead>
              <tbody>
                {warehouses.map((w) => (
                  <tr key={w.id}>
                    <td>{w.branch}</td>
                    <td style={{ fontWeight: 600 }}>{w.label}</td>
                    <td className="num">{w.skus}</td>
                    <td className="num">{qty(w.on_hand)}</td>
                    <td className="num">{qty(w.available)}</td>
                    <td className="num">{money(w.stock_value)}</td>
                  </tr>
                ))}
                {!warehouses.length ? (
                  <tr>
                    <td colSpan={6} style={{ color: 'var(--ink-muted)' }}>
                      {loading ? 'Loading…' : 'No stock for this selection.'}
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          ) : null}

          {view === 'detail' ? (
            <table className="table">
              <thead>
                <tr>
                  <th>Product</th>
                  <th>Branch</th>
                  <th>Warehouse</th>
                  <th>UoM</th>
                  <th className="num">Lots</th>
                  <th className="num">On hand</th>
                  <th className="num">Reserved</th>
                  <th className="num">Available</th>
                  <th className="num">Avg cost</th>
                  <th className="num">Stock value</th>
                </tr>
              </thead>
              <tbody>
                {detailRows.map((r) => (
                  <tr key={`${r.variant_id}:${r.warehouse_id}`}>
                    <td>
                      <div style={{ fontWeight: 600 }}>{productLabel(r)}</div>
                      <div className="invoice-view__sub">{r.variant_sku || r.product_sku || ''}</div>
                    </td>
                    <td>{r.branch_name}</td>
                    <td>
                      {r.warehouse_code} — {r.warehouse_name}
                    </td>
                    <td>{r.uom || '—'}</td>
                    <td className="num">{r.lots}</td>
                    <td className="num">{qty(r.on_hand)}</td>
                    <td className="num">{qty(r.reserved)}</td>
                    <td className="num">{qty(r.available)}</td>
                    <td className="num">{r.avg_cost == null ? '—' : money(r.avg_cost)}</td>
                    <td className="num">{money(r.stock_value)}</td>
                  </tr>
                ))}
                {!detailRows.length ? (
                  <tr>
                    <td colSpan={10} style={{ color: 'var(--ink-muted)' }}>
                      {loading ? 'Loading…' : 'No stock for this selection.'}
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          ) : null}
        </div>
      </div>
    </div>
  );
};
