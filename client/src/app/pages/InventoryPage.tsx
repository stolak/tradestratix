import React, { useEffect, useMemo, useState } from 'react';
import { api } from '../utils/api';
import { alertError, alertSuccess, confirmAction } from '../utils/alerts';

type TransferLine = { product_id: string; quantity: string };

export const InventoryPage: React.FC = () => {
  const [tab, setTab] = useState<'board' | 'movements' | 'expiry' | 'transfers'>('board');
  const [board, setBoard] = useState<any[]>([]);
  const [movements, setMovements] = useState<any[]>([]);
  const [expiry, setExpiry] = useState<any[]>([]);
  const [transfers, setTransfers] = useState<any[]>([]);
  const [products, setProducts] = useState<any[]>([]);
  const [warehouses, setWarehouses] = useState<any[]>([]);
  const [fromWarehouses, setFromWarehouses] = useState<any[]>([]);
  const [toWarehouses, setToWarehouses] = useState<any[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [receive, setReceive] = useState({
    product_id: '',
    warehouse_id: '',
    quantity: '1',
    unit_cost: '',
    batch_number: '',
    expiry_date: ''
  });
  const [transferForm, setTransferForm] = useState({
    from_warehouse_id: '',
    to_warehouse_id: '',
    notes: '',
    lines: [{ product_id: '', quantity: '1' }] as TransferLine[]
  });

  const load = async () => {
    try {
      const [b, m, e, t, p, w, tw] = await Promise.all([
        api.inventory.board(),
        api.inventory.movements(),
        api.inventory.expiry(90),
        api.inventory.transfers(),
        api.products.list(),
        api.warehouses.list(),
        api.inventory.transferWarehouses().catch(() => ({ from: [], to: [] }))
      ]);
      setBoard(b);
      setMovements(m);
      setExpiry(e);
      setTransfers(t);
      setProducts(p);
      setWarehouses(w);
      setFromWarehouses(tw.from || []);
      setToWarehouses(tw.to || []);
      setReceive((r) => ({
        ...r,
        product_id: r.product_id || p[0]?.id || '',
        warehouse_id: r.warehouse_id || w[0]?.id || ''
      }));
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

  const selectedProduct = products.find((p) => p.id === receive.product_id);

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

  const onReceive = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await api.inventory.receive({
        product_id: receive.product_id,
        warehouse_id: receive.warehouse_id,
        quantity: Number(receive.quantity),
        unit_cost: receive.unit_cost ? Number(receive.unit_cost) : undefined,
        batch_number: receive.batch_number || undefined,
        expiry_date: receive.expiry_date || undefined
      });
      await alertSuccess('Stock received');
      await load();
    } catch (err: any) {
      await alertError('Receive failed', err.message);
    }
  };

  const onIssue = async () => {
    try {
      await api.inventory.issue({
        product_id: receive.product_id,
        warehouse_id: receive.warehouse_id,
        quantity: Number(receive.quantity)
      });
      await alertSuccess('Stock issued (FEFO/FIFO)');
      await load();
    } catch (err: any) {
      await alertError('Issue failed', err.message);
    }
  };

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
          Stock board, movements, and warehouse transfers (goods in transit until received).
        </p>
      </header>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {(
          [
            ['board', 'Stock board'],
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

      {tab !== 'transfers' ? (
        <form onSubmit={onReceive} className="card-surface" style={{ padding: '1rem' }}>
          <div className="form-grid">
            <div className="field">
              <label>Product</label>
              <select
                value={receive.product_id}
                onChange={(e) => setReceive({ ...receive, product_id: e.target.value })}
              >
                {products.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label>Warehouse</label>
              <select
                value={receive.warehouse_id}
                onChange={(e) => setReceive({ ...receive, warehouse_id: e.target.value })}
              >
                {warehouses.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.code}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label>Qty (base)</label>
              <input
                type="number"
                value={receive.quantity}
                onChange={(e) => setReceive({ ...receive, quantity: e.target.value })}
                required
              />
            </div>
            <div className="field">
              <label>Unit cost</label>
              <input
                type="number"
                value={receive.unit_cost}
                onChange={(e) => setReceive({ ...receive, unit_cost: e.target.value })}
              />
            </div>
            <div className="field">
              <label>Batch {selectedProduct?.track_batch ? '*' : ''}</label>
              <input
                value={receive.batch_number}
                onChange={(e) => setReceive({ ...receive, batch_number: e.target.value })}
                required={Boolean(selectedProduct?.track_batch || selectedProduct?.track_expiry)}
              />
            </div>
            <div className="field">
              <label>Expiry {selectedProduct?.track_expiry ? '*' : ''}</label>
              <input
                type="date"
                value={receive.expiry_date}
                onChange={(e) => setReceive({ ...receive, expiry_date: e.target.value })}
                required={Boolean(selectedProduct?.track_expiry)}
              />
            </div>
            <div className="form-grid--actions">
              <button className="btn btn-primary" type="submit">
                Receive
              </button>
              <button className="btn btn-ghost" type="button" onClick={() => void onIssue()}>
                Issue
              </button>
            </div>
          </div>
        </form>
      ) : null}

      {tab === 'board' ? (
        <div className="card-surface" style={{ padding: '0.5rem 0' }}>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Product</th>
                  <th className="num">On hand</th>
                  <th className="num">Available</th>
                  <th className="num">In transit</th>
                  <th>Lots</th>
                  <th>Nearest expiry</th>
                  <th>Alerts</th>
                </tr>
              </thead>
              <tbody>
                {board.map((p) => (
                  <tr key={p.id}>
                    <td>
                      {p.name}
                      <div style={{ fontSize: 12, color: 'var(--ink-muted)' }}>{p.sku}</div>
                    </td>
                    <td className="num">{p.on_hand}</td>
                    <td className="num">{p.available}</td>
                    <td className="num">{p.in_transit || 0}</td>
                    <td>{p.lots_count}</td>
                    <td>{p.nearest_expiry || '—'}</td>
                    <td>
                      {p.is_low_stock ? 'Low stock' : ''}
                      {p.has_expired_lots ? (p.is_low_stock ? ' · Expired' : 'Expired') : ''}
                      {!p.is_low_stock && !p.has_expired_lots ? '—' : ''}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      {tab === 'movements' ? (
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
              </tbody>
            </table>
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
