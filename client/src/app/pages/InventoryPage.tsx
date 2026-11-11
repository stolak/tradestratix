import React, { useEffect, useState } from 'react';
import { api } from '../utils/api';
import { alertError, alertSuccess } from '../utils/alerts';

export const InventoryPage: React.FC = () => {
  const [tab, setTab] = useState<'board' | 'movements' | 'expiry' | 'transfers'>('board');
  const [board, setBoard] = useState<any[]>([]);
  const [movements, setMovements] = useState<any[]>([]);
  const [expiry, setExpiry] = useState<any[]>([]);
  const [transfers, setTransfers] = useState<any[]>([]);
  const [products, setProducts] = useState<any[]>([]);
  const [warehouses, setWarehouses] = useState<any[]>([]);
  const [receive, setReceive] = useState({
    product_id: '',
    warehouse_id: '',
    quantity: '1',
    unit_cost: '',
    batch_number: '',
    expiry_date: ''
  });

  const load = async () => {
    try {
      const [b, m, e, t, p, w] = await Promise.all([
        api.inventory.board(),
        api.inventory.movements(),
        api.inventory.expiry(90),
        api.inventory.transfers(),
        api.products.list(),
        api.warehouses.list()
      ]);
      setBoard(b);
      setMovements(m);
      setExpiry(e);
      setTransfers(t);
      setProducts(p);
      setWarehouses(w);
      setReceive((r) => ({
        ...r,
        product_id: r.product_id || p[0]?.id || '',
        warehouse_id: r.warehouse_id || w[0]?.id || ''
      }));
    } catch (err: any) {
      await alertError('Inventory', err.message);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const selectedProduct = products.find((p) => p.id === receive.product_id);

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

  return (
    <div className="page-stack">
      <header>
        <h1 className="display" style={{ margin: 0, fontSize: '2.2rem' }}>
          Inventory
        </h1>
        <p style={{ color: 'var(--ink-muted)', margin: '0.35rem 0 0' }}>
          All quantity changes go through the inventory posting engine (lots + FEFO).
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

      {tab === 'board' ? (
        <div className="card-surface" style={{ padding: '0.5rem 0' }}>
          <div className="table-wrap">
            <table className="table">
            <thead>
              <tr>
                <th>Product</th>
                <th>On hand</th>
                <th>Available</th>
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
                  <td>{p.on_hand}</td>
                  <td>{p.available}</td>
                  <td>{p.lots_count}</td>
                  <td>{p.nearest_expiry || '—'}</td>
                  <td>
                    {p.is_low_stock ? 'Low stock · ' : ''}
                    {p.has_expired_lots ? 'Expired lots' : '—'}
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
                <th>In</th>
                <th>Out</th>
                <th>Batch</th>
                <th>Warehouse</th>
              </tr>
            </thead>
            <tbody>
              {movements.map((m) => (
                <tr key={m.id}>
                  <td>{String(m.created_at).replace('T', ' ').slice(0, 19)}</td>
                  <td>{m.movement_type}</td>
                  <td>{m.product?.name}</td>
                  <td>{m.quantity_in}</td>
                  <td>{m.quantity_out}</td>
                  <td>{m.batch_number || '—'}</td>
                  <td>{m.warehouse?.code}</td>
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
                <th>Batch</th>
                <th>Expiry</th>
                <th>Qty</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {expiry.map((l) => (
                <tr key={l.id}>
                  <td>{l.product?.name}</td>
                  <td>{l.batch_number}</td>
                  <td>{l.expiry_date}</td>
                  <td>{l.quantity_on_hand}</td>
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
        <div className="card-surface" style={{ padding: '0.5rem 0' }}>
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
              {transfers.map((t) => (
                <tr key={t.id}>
                  <td>{t.transfer_number}</td>
                  <td>{t.from_warehouse?.code}</td>
                  <td>{t.to_warehouse?.code}</td>
                  <td>{t.status}</td>
                  <td>{t.items?.length ?? 0}</td>
                  <td style={{ display: 'flex', gap: 6 }}>
                    {t.status === 'pending_approval' ? (
                      <button
                        type="button"
                        className="btn btn-ghost"
                        onClick={async () => {
                          try {
                            await api.inventory.approveTransfer(t.id);
                            await load();
                          } catch (err: any) {
                            await alertError('Approve failed', err.message);
                          }
                        }}
                      >
                        Approve
                      </button>
                    ) : null}
                    {['approved', 'pending_approval'].includes(t.status) ? (
                      <button
                        type="button"
                        className="btn btn-ghost"
                        onClick={async () => {
                          try {
                            await api.inventory.dispatchTransfer(t.id);
                            await load();
                          } catch (err: any) {
                            await alertError('Dispatch failed', err.message);
                          }
                        }}
                      >
                        Dispatch
                      </button>
                    ) : null}
                    {t.status === 'in_transit' ? (
                      <button
                        type="button"
                        className="btn btn-primary"
                        onClick={async () => {
                          try {
                            await api.inventory.receiveTransfer(t.id);
                            await alertSuccess('Transfer received');
                            await load();
                          } catch (err: any) {
                            await alertError('Receive failed', err.message);
                          }
                        }}
                      >
                        Receive
                      </button>
                    ) : null}
                  </td>
                </tr>
              ))}
              {!transfers.length ? (
                <tr>
                  <td colSpan={6}>No transfers yet — create via API or next UI iteration</td>
                </tr>
              ) : null}
            </tbody>
          </table>
          </div>
        </div>
      ) : null}
    </div>
  );
};
