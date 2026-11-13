import React, { useEffect, useMemo, useState } from 'react';
import { api } from '../utils/api';
import { alertError, alertSuccess, confirmAction } from '../utils/alerts';
import { StockBalanceReport } from '../components/StockBalanceReport';

type TransferLine = { product_id: string; quantity: string };
type InventoryTab = 'stock' | 'movements' | 'expiry' | 'transfers';

const MOVEMENT_TYPES = [
  'receive',
  'issue',
  'sale',
  'sales_return',
  'adjust_in',
  'adjust_out',
  'transfer_hold',
  'transfer_out',
  'transfer_in',
  'transfer_cancel'
] as const;

export const InventoryPage: React.FC = () => {
  const [tab, setTab] = useState<InventoryTab>('stock');
  const [movements, setMovements] = useState<any[]>([]);
  const [movementsLoading, setMovementsLoading] = useState(false);
  const [expiry, setExpiry] = useState<any[]>([]);
  const [transfers, setTransfers] = useState<any[]>([]);
  const [products, setProducts] = useState<any[]>([]);
  const [warehouses, setWarehouses] = useState<any[]>([]);
  const [fromWarehouses, setFromWarehouses] = useState<any[]>([]);
  const [toWarehouses, setToWarehouses] = useState<any[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [movementFilter, setMovementFilter] = useState({
    warehouse_id: '',
    product_id: '',
    movement_type: '',
    from: '',
    to: ''
  });
  const [transferForm, setTransferForm] = useState({
    from_warehouse_id: '',
    to_warehouse_id: '',
    notes: '',
    lines: [{ product_id: '', quantity: '1' }] as TransferLine[]
  });

  const loadMovements = async (filter = movementFilter) => {
    setMovementsLoading(true);
    try {
      setMovements(
        await api.inventory.movements({
          warehouse_id: filter.warehouse_id || undefined,
          product_id: filter.product_id || undefined,
          movement_type: filter.movement_type || undefined,
          from: filter.from || undefined,
          to: filter.to || undefined
        })
      );
    } catch (err: any) {
      await alertError('Movements', err.message);
    } finally {
      setMovementsLoading(false);
    }
  };

  const load = async () => {
    try {
      const [m, e, t, p, w, tw] = await Promise.all([
        api.inventory.movements(),
        api.inventory.expiry(90),
        api.inventory.transfers(),
        api.products.list(),
        api.warehouses.list().catch(() => []),
        api.inventory.transferWarehouses().catch(() => ({ from: [], to: [] }))
      ]);
      setMovements(m);
      setExpiry(e);
      setTransfers(t);
      setProducts(p);
      setWarehouses(w);
      setFromWarehouses(tw.from || []);
      setToWarehouses(tw.to || []);
      setTransferForm((f) => {
        const fromId = f.from_warehouse_id || tw.from?.[0]?.id || '';
        const toCandidates = (tw.to || []).filter((x: any) => x.id !== fromId);
        const toId =
          f.to_warehouse_id && f.to_warehouse_id !== fromId
            ? f.to_warehouse_id
            : toCandidates[0]?.id || '';
        return {
          ...f,
          from_warehouse_id: fromId,
          to_warehouse_id: toId,
          lines: f.lines[0]?.product_id
            ? f.lines
            : [{ product_id: p[0]?.id || '', quantity: '1' }]
        };
      });
    } catch (err: any) {
      await alertError('Inventory', err.message);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const fromWh = useMemo(
    () => fromWarehouses.find((w) => w.id === transferForm.from_warehouse_id),
    [fromWarehouses, transferForm.from_warehouse_id]
  );

  const destinationOptions = useMemo(() => {
    return toWarehouses.filter((w) => {
      if (w.id === transferForm.from_warehouse_id) return false;
      if (!fromWh) return true;
      const sameBranch = (w.branch_id || w.branch?.id) === (fromWh.branch_id || fromWh.branch?.id);
      if (sameBranch) return true;
      const fromOk = fromWh.warehouse_category?.allow_inter_branch_transfer !== false;
      const toOk = w.warehouse_category?.allow_inter_branch_transfer !== false;
      return fromOk && toOk;
    });
  }, [toWarehouses, transferForm.from_warehouse_id, fromWh]);

  // Keep To in sync when From changes or current To is no longer a valid option
  // (browser can show the first option while React state still holds the old/same id).
  useEffect(() => {
    if (!destinationOptions.length) return;
    const valid = destinationOptions.some((w) => w.id === transferForm.to_warehouse_id);
    if (!valid) {
      setTransferForm((f) => ({ ...f, to_warehouse_id: destinationOptions[0].id }));
    }
  }, [destinationOptions, transferForm.to_warehouse_id]);

  const sendTransfer = async (e: React.FormEvent) => {
    e.preventDefault();
    const fromId = transferForm.from_warehouse_id;
    const toId = transferForm.to_warehouse_id;
    if (!fromId || !toId) {
      await alertError('Warehouses required', 'Select both a source and destination warehouse.');
      return;
    }
    if (fromId === toId) {
      await alertError(
        'Invalid destination',
        'Choose a different To warehouse than From.'
      );
      return;
    }
    const items = transferForm.lines
      .map((l) => ({
        product_id: l.product_id,
        quantity: Number(l.quantity)
      }))
      .filter((l) => l.product_id && l.quantity > 0);
    if (!items.length) {
      await alertError('Add lines', 'Add at least one product with quantity.');
      return;
    }
    try {
      await api.inventory.createTransfer({
        from_warehouse_id: fromId,
        to_warehouse_id: toId,
        notes: transferForm.notes || undefined,
        items
      });
      await alertSuccess('Transfer sent', 'Stock is in transit at the source until received.');
      setTransferForm((f) => ({
        ...f,
        notes: '',
        lines: [{ product_id: products[0]?.id || '', quantity: '1' }]
      }));
      await load();
    } catch (err: any) {
      await alertError('Transfer failed', err.message);
    }
  };

  const actTransfer = async (id: string, action: 'receive' | 'cancel' | 'dispatch') => {
    const labels = {
      receive: ['Receive transfer?', 'Stock will land in the destination warehouse.'],
      cancel: ['Cancel transfer?', 'In-transit hold will be released back to available at source.'],
      dispatch: ['Dispatch transfer?', 'Stock will be held in transit at source.']
    } as const;
    const ok = await confirmAction(labels[action][0], labels[action][1]);
    if (!ok) return;
    setBusyId(id);
    try {
      if (action === 'receive') await api.inventory.receiveTransfer(id);
      else if (action === 'cancel') await api.inventory.cancelTransfer(id);
      else await api.inventory.dispatchTransfer(id);
      await alertSuccess(
        action === 'receive' ? 'Transfer received' : action === 'cancel' ? 'Transfer cancelled' : 'Transfer dispatched'
      );
      await load();
    } catch (err: any) {
      await alertError('Action failed', err.message);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="page-stack">
      <header>
        <h1 className="display" style={{ margin: 0, fontSize: '2.2rem' }}>
          Inventory
        </h1>
        <p style={{ color: 'var(--ink-muted)', margin: '0.35rem 0 0' }}>
          Stock balance, movements, and warehouse transfers (goods in transit until received).
        </p>
      </header>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {(
          [
            ['stock', 'Stock balance'],
            ['movements', 'Movements'],
            ['expiry', 'Expiry'],
            ['transfers', 'Transfers']
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
      </div>

      {tab === 'stock' ? <StockBalanceReport /> : null}

      {tab === 'movements' ? (
        <div style={{ display: 'grid', gap: 12 }}>
          <form
            className="card-surface cust-bal__filters"
            onSubmit={(e) => {
              e.preventDefault();
              void loadMovements();
            }}
          >
            <div className="field">
              <label>Warehouse</label>
              <select
                value={movementFilter.warehouse_id}
                onChange={(e) => setMovementFilter((f) => ({ ...f, warehouse_id: e.target.value }))}
              >
                <option value="">All warehouses</option>
                {warehouses.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.code} — {w.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label>Type</label>
              <select
                value={movementFilter.movement_type}
                onChange={(e) => setMovementFilter((f) => ({ ...f, movement_type: e.target.value }))}
              >
                <option value="">All types</option>
                {MOVEMENT_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label>Product</label>
              <select
                value={movementFilter.product_id}
                onChange={(e) => setMovementFilter((f) => ({ ...f, product_id: e.target.value }))}
              >
                <option value="">All products</option>
                {products.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                    {p.sku ? ` (${p.sku})` : ''}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label>From</label>
              <input
                type="date"
                value={movementFilter.from}
                onChange={(e) => setMovementFilter((f) => ({ ...f, from: e.target.value }))}
              />
            </div>
            <div className="field">
              <label>To</label>
              <input
                type="date"
                value={movementFilter.to}
                onChange={(e) => setMovementFilter((f) => ({ ...f, to: e.target.value }))}
              />
            </div>
            <button type="submit" className="btn btn-primary" disabled={movementsLoading}>
              {movementsLoading ? 'Filtering…' : 'Apply'}
            </button>
            <button
              type="button"
              className="btn btn-ghost"
              disabled={movementsLoading}
              onClick={() => {
                const cleared = {
                  warehouse_id: '',
                  product_id: '',
                  movement_type: '',
                  from: '',
                  to: ''
                };
                setMovementFilter(cleared);
                void loadMovements(cleared);
              }}
            >
              Clear
            </button>
          </form>

          <div className="card-surface" style={{ padding: '0.5rem 0' }}>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>When</th>
                    <th>Type</th>
                    <th>Product</th>
                    <th>Warehouse</th>
                    <th className="num">In</th>
                    <th className="num">Out</th>
                  </tr>
                </thead>
                <tbody>
                  {movements.map((m) => (
                    <tr key={m.id}>
                      <td>{String(m.created_at || '').slice(0, 19).replace('T', ' ')}</td>
                      <td>{m.movement_type}</td>
                      <td>{m.product?.name}</td>
                      <td>{m.warehouse?.code}</td>
                      <td className="num">{m.quantity_in}</td>
                      <td className="num">{m.quantity_out}</td>
                    </tr>
                  ))}
                  {!movements.length ? (
                    <tr>
                      <td colSpan={6} style={{ textAlign: 'center', color: 'var(--ink-muted)' }}>
                        {movementsLoading ? 'Loading…' : 'No movements for this filter.'}
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      ) : null}

      {tab === 'expiry' ? (
        <div className="card-surface" style={{ padding: '0.5rem 0' }}>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Product</th>
                  <th>Warehouse</th>
                  <th>Batch</th>
                  <th>Expiry</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {expiry.map((l) => (
                  <tr key={l.id}>
                    <td>{l.product?.name}</td>
                    <td>{l.warehouse?.code}</td>
                    <td>{l.batch_number}</td>
                    <td>{l.expiry_date}</td>
                    <td>{l.is_expired ? 'Expired' : 'Near expiry'}</td>
                  </tr>
                ))}
                {!expiry.length ? (
                  <tr>
                    <td colSpan={5}>No near-expiry or expired lots in the next 90 days</td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      {tab === 'transfers' ? (
        <>
          <form
            onSubmit={sendTransfer}
            className="card-surface"
            style={{ padding: '1rem', display: 'grid', gap: 12 }}
          >
            <div style={{ fontWeight: 700 }}>Send transfer</div>
            <p style={{ margin: 0, color: 'var(--ink-muted)', fontSize: '0.9rem' }}>
              Stock stays on the source warehouse as <strong>in transit</strong> (not available) until
              the destination receives it. Same-branch is stock-only; inter-branch also posts GIT
              journals (and requires both warehouse categories to allow it).
            </p>
            <div className="form-grid">
              <div className="field">
                <label>From warehouse</label>
                <select
                  value={transferForm.from_warehouse_id}
                  onChange={(e) => {
                    const nextFrom = e.target.value;
                    setTransferForm((f) => {
                      const nextTo =
                        f.to_warehouse_id === nextFrom
                          ? toWarehouses.find((w) => w.id !== nextFrom)?.id || ''
                          : f.to_warehouse_id;
                      return { ...f, from_warehouse_id: nextFrom, to_warehouse_id: nextTo };
                    });
                  }}
                  required
                >
                  {fromWarehouses.map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.code} — {w.name}
                      {w.branch?.code ? ` (${w.branch.code})` : ''}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label>To warehouse</label>
                <select
                  value={
                    destinationOptions.some((w) => w.id === transferForm.to_warehouse_id)
                      ? transferForm.to_warehouse_id
                      : destinationOptions[0]?.id || ''
                  }
                  onChange={(e) =>
                    setTransferForm({ ...transferForm, to_warehouse_id: e.target.value })
                  }
                  required
                >
                  {destinationOptions.map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.code} — {w.name}
                      {w.branch?.code ? ` (${w.branch.code})` : ''}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label>Notes</label>
                <input
                  value={transferForm.notes}
                  onChange={(e) => setTransferForm({ ...transferForm, notes: e.target.value })}
                  placeholder="Optional"
                />
              </div>
            </div>

            <div className="line-items">
              <div className="line-items__scroll">
                <table className="line-items__table" style={{ minWidth: 480, width: '100%' }}>
                  <thead>
                    <tr>
                      <th>Product</th>
                      <th className="num" style={{ width: 120 }}>
                        Qty
                      </th>
                      <th style={{ width: 80 }} />
                    </tr>
                  </thead>
                  <tbody>
                    {transferForm.lines.map((line, idx) => (
                      <tr key={idx}>
                        <td>
                          <select
                            value={line.product_id}
                            onChange={(e) => {
                              const lines = [...transferForm.lines];
                              lines[idx] = { ...lines[idx], product_id: e.target.value };
                              setTransferForm({ ...transferForm, lines });
                            }}
                            required
                          >
                            {products.map((p) => (
                              <option key={p.id} value={p.id}>
                                {p.name}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td>
                          <input
                            type="number"
                            min="0.0001"
                            step="any"
                            className="qty-input"
                            style={{ textAlign: 'right' }}
                            value={line.quantity}
                            onChange={(e) => {
                              const lines = [...transferForm.lines];
                              lines[idx] = { ...lines[idx], quantity: e.target.value };
                              setTransferForm({ ...transferForm, lines });
                            }}
                            required
                          />
                        </td>
                        <td>
                          <button
                            type="button"
                            className="btn btn-ghost"
                            disabled={transferForm.lines.length <= 1}
                            onClick={() =>
                              setTransferForm({
                                ...transferForm,
                                lines: transferForm.lines.filter((_, i) => i !== idx)
                              })
                            }
                          >
                            Remove
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="recv-pay__actions-row" style={{ padding: '0.5rem 0' }}>
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={() =>
                    setTransferForm({
                      ...transferForm,
                      lines: [
                        ...transferForm.lines,
                        { product_id: products[0]?.id || '', quantity: '1' }
                      ]
                    })
                  }
                >
                  Add line
                </button>
                <button className="btn btn-primary" type="submit">
                  Send transfer
                </button>
              </div>
            </div>
          </form>

          <div className="card-surface" style={{ padding: '0.5rem 0' }}>
            <div style={{ padding: '0.75rem 1rem', fontWeight: 600 }}>Transfer history</div>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Number</th>
                    <th>From</th>
                    <th>To</th>
                    <th>Status</th>
                    <th>Items</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {transfers.map((t) => {
                    const busy = busyId === t.id;
                    return (
                      <tr key={t.id}>
                        <td>{t.transfer_number}</td>
                        <td>{t.from_warehouse?.code}</td>
                        <td>{t.to_warehouse?.code}</td>
                        <td>{t.status}</td>
                        <td>{t.items?.length ?? 0}</td>
                        <td>
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                            {['pending_approval', 'approved', 'draft'].includes(t.status) ? (
                              <button
                                type="button"
                                className="btn btn-ghost"
                                disabled={busy}
                                onClick={() => void actTransfer(t.id, 'dispatch')}
                              >
                                Dispatch
                              </button>
                            ) : null}
                            {t.status === 'in_transit' ? (
                              <>
                                <button
                                  type="button"
                                  className="btn btn-primary"
                                  disabled={busy}
                                  onClick={() => void actTransfer(t.id, 'receive')}
                                >
                                  Receive
                                </button>
                                <button
                                  type="button"
                                  className="btn btn-ghost"
                                  disabled={busy}
                                  onClick={() => void actTransfer(t.id, 'cancel')}
                                  style={{ color: 'var(--danger)' }}
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
                  {!transfers.length ? (
                    <tr>
                      <td colSpan={6} style={{ color: 'var(--ink-muted)' }}>
                        No transfers yet.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
};
