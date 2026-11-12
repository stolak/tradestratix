import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import Swal from 'sweetalert2';
import { ClipboardList, PackageCheck, RefreshCw, Search, Truck, X } from 'lucide-react';
import { api } from '../utils/api';
import { alertError, alertSuccess } from '../utils/alerts';
import { useAuth } from '../context/AuthContext';
import { InvoiceViewModal } from '../components/InvoiceViewModal';

type Tab = 'to_pick' | 'picking' | 'ready' | 'delivery' | 'done' | 'issues';

function fmtDate(v: unknown, withTime = false) {
  if (!v) return '—';
  const d = new Date(String(v));
  if (Number.isNaN(d.getTime())) return '—';
  return withTime ? d.toLocaleString() : d.toLocaleDateString();
}

function qty(v: unknown) {
  return Number(v || 0).toLocaleString(undefined, { maximumFractionDigits: 4 });
}

const PAYMENT_LABELS: Record<string, string> = { paid: 'paid', partial: 'part paid', open: 'unpaid', void: 'void' };

const STATUS_LABELS: Record<string, string> = {
  picking: 'Picking',
  ready_for_collection: 'Ready for collection',
  picked: 'Awaiting dispatch',
  dispatched: 'Out for delivery',
  released: 'Collected',
  delivered: 'Delivered',
  cancelled: 'Cancelled',
  discrepancy: 'Discrepancy'
};

const STATUS_CHIP: Record<string, string> = {
  picking: 'pending',
  ready_for_collection: 'partial',
  picked: 'pending',
  dispatched: 'partial',
  released: 'fulfilled',
  delivered: 'fulfilled',
  cancelled: 'cancelled',
  discrepancy: 'void'
};

const ID_TYPES = [
  ['', 'No ID checked'],
  ['national_id', 'National ID'],
  ['drivers_licence', "Driver's licence"],
  ['passport', 'Passport'],
  ['voters_card', "Voter's card"],
  ['company_id', 'Company ID / waybill'],
  ['other', 'Other']
];

function lineLabel(item: any) {
  const ii = item.invoice_item || item;
  return (
    <>
      <div className="invoice-view__strong">{ii.product?.name}</div>
      <div className="invoice-view__sub">{[ii.product?.sku, ii.variant?.name].filter(Boolean).join(' · ')}</div>
    </>
  );
}

export const PickupsPage: React.FC = () => {
  const { activeBranchId, can } = useAuth();
  const canViewInvoice = can('sales.view', 'pos.view');
  const canPick = can('fulfilment.pick');
  const canRelease = can('sales.fulfil');
  const canDispatch = can('fulfilment.dispatch');
  const [tab, setTab] = useState<Tab>('to_pick');
  const [warehouseId, setWarehouseId] = useState('');
  const [q, setQ] = useState('');
  const [search, setSearch] = useState('');
  const [data, setData] = useState<{ warehouses: any[]; summary: Record<string, number>; awaiting: any[]; tasks: any[] }>({
    warehouses: [],
    summary: {},
    awaiting: [],
    tasks: []
  });
  const [vehicles, setVehicles] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [modal, setModal] = useState<
    | { kind: 'quick'; row: any }
    | { kind: 'pick'; taskId: string }
    | { kind: 'collect'; taskId: string }
    | { kind: 'dispatch'; task: any }
    | { kind: 'deliver'; taskId: string }
    | null
  >(null);
  const [viewInvoiceId, setViewInvoiceId] = useState<string | null>(null);
  const [codePanelKey, setCodePanelKey] = useState(0);

  const load = async () => {
    setLoading(true);
    try {
      setData(await api.sales.warehouseDashboard({ warehouse_id: warehouseId || undefined, q: search || undefined }));
    } catch (err: any) {
      await alertError('Warehouse fulfilment', err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, [warehouseId, search, activeBranchId]);

  useEffect(() => {
    if (!canDispatch) return;
    api.distribution.vehicles().then(setVehicles).catch(() => setVehicles([]));
  }, [canDispatch]);

  useEffect(() => {
    const t = setTimeout(() => setSearch(q.trim()), 350);
    return () => clearTimeout(t);
  }, [q]);

  const tasksBy = useMemo(() => {
    const t = data.tasks || [];
    return {
      picking: t.filter((x) => x.status === 'picking'),
      ready: t.filter((x) => x.status === 'ready_for_collection'),
      delivery: t.filter((x) => x.status === 'picked' || x.status === 'dispatched'),
      done: t.filter((x) => x.status === 'released' || x.status === 'delivered'),
      issues: t.filter((x) => x.has_discrepancy)
    };
  }, [data.tasks]);

  const startPicking = async (row: any) => {
    try {
      const task = await api.sales.startPicking({ invoice_id: row.invoice_id, warehouse_id: row.warehouse?.id });
      await load();
      setModal({ kind: 'pick', taskId: task.id });
    } catch (err: any) {
      await alertError('Could not start picking', err.message);
    }
  };

  const cancelTask = async (task: any) => {
    const res = await Swal.fire({
      title: `Cancel ${task.fulfilment_number}?`,
      text: 'Picked goods go back on the shelf. The stock stays reserved for the order.',
      input: 'text',
      inputPlaceholder: 'Reason',
      showCancelButton: true,
      confirmButtonText: 'Cancel picking list',
      confirmButtonColor: '#0f5c4c',
      inputValidator: (v) => (!v?.trim() ? 'A reason is required' : undefined)
    });
    if (!res.isConfirmed) return;
    try {
      await api.sales.cancelFulfilment(task.id, String(res.value).trim());
      await load();
    } catch (err: any) {
      await alertError('Cancel failed', err.message);
    }
  };

  const s = data.summary || {};
  const cards: { label: string; value: number; tab?: Tab; tone?: string }[] = [
    { label: 'Awaiting picking', value: s.awaiting_picking || 0, tab: 'to_pick' },
    { label: 'Picking in progress', value: s.picking || 0, tab: 'picking' },
    { label: 'Ready for pickup', value: s.ready_for_collection || 0, tab: 'ready' },
    { label: 'Awaiting dispatch', value: s.awaiting_dispatch || 0, tab: 'delivery' },
    { label: 'Out for delivery', value: s.out_for_delivery || 0, tab: 'delivery' },
    { label: 'Partially fulfilled', value: s.partially_fulfilled || 0 },
    { label: 'Overdue collection', value: s.overdue_collection || 0, tab: 'ready', tone: 'warn' },
    { label: 'Discrepancies (30 days)', value: s.discrepancies || 0, tab: 'issues', tone: 'warn' }
  ];

  const invoiceCell = (inv: any, invoiceId: string, number: string) =>
    canViewInvoice ? (
      <button type="button" className="invoice-link" onClick={() => setViewInvoiceId(invoiceId)}>
        {number}
      </button>
    ) : (
      number
    );

  const taskTable = (rows: any[], empty: string, actions: (t: any) => React.ReactNode) => (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            <th>Fulfilment</th>
            <th>Order</th>
            <th>Customer</th>
            <th>Warehouse</th>
            <th>Goods</th>
            <th>Status</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {rows.map((t) => (
            <tr key={t.id}>
              <td>
                {t.fulfilment_number}
                <div className="line-items__discount-note">
                  {t.fulfilment_type === 'delivery' ? 'Delivery' : 'Pickup'} · {fmtDate(t.created_at)}
                </div>
              </td>
              <td>{invoiceCell(t.invoice, t.invoice?.id, t.invoice?.invoice_number)}</td>
              <td>
                <div style={{ fontWeight: 600 }}>{t.invoice?.customer?.name}</div>
                {t.invoice?.customer?.phone ? <div className="line-items__discount-note">{t.invoice.customer.phone}</div> : null}
              </td>
              <td>
                {t.warehouse?.name}
                <div className="line-items__discount-note">{t.warehouse?.branch?.name}</div>
              </td>
              <td>
                {(t.items || [])
                  .slice(0, 3)
                  .map((i: any) => {
                    const n =
                      t.status === 'picking'
                        ? i.planned_quantity
                        : ['released', 'delivered'].includes(t.status)
                          ? i.quantity
                          : i.picked_quantity;
                    return `${qty(n)} ${i.invoice_item?.uom?.code || ''} ${i.invoice_item?.product?.name}`;
                  })
                  .join(', ')}
                {(t.items || []).length > 3 ? ` +${t.items.length - 3} more` : ''}
                {t.discrepancy_notes ? <div className="invoice-view__danger" style={{ fontSize: '0.78rem' }}>{t.discrepancy_notes}</div> : null}
              </td>
              <td>
                <span className={`invoice-chip invoice-chip--${STATUS_CHIP[t.status] || 'pending'}`}>
                  {STATUS_LABELS[t.status] || t.status}
                </span>
                {t.overdue ? <div className="invoice-view__danger" style={{ fontSize: '0.78rem' }}>hold expiring</div> : null}
                {t.delivery_order ? <div className="line-items__discount-note">{t.delivery_order.delivery_number}</div> : null}
              </td>
              <td style={{ whiteSpace: 'nowrap' }}>{actions(t)}</td>
            </tr>
          ))}
          {!rows.length ? (
            <tr>
              <td colSpan={7} style={{ textAlign: 'center', color: 'var(--ink-muted)', padding: '2rem' }}>
                {loading ? 'Loading…' : empty}
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>
    </div>
  );

  return (
    <div className="page-stack">
      <header>
        <h1 className="display" style={{ margin: 0, fontSize: '2.2rem' }}>
          Warehouse fulfilment
        </h1>
        <p style={{ color: 'var(--ink-muted)', margin: '0.35rem 0 0' }}>
          Customer walks in with a pickup code — look it up below and release what is reserved here. The same code works
          for part-collections and other branches that hold the balance. Stock and revenue post only at hand-over.
        </p>
      </header>

      {(canRelease || canPick) && (
        <CodeLookupBar
          key={codePanelKey}
          canRelease={canRelease}
          canPick={canPick}
          onQuick={(row) => setModal({ kind: 'quick', row })}
          onPick={async (invoiceId, warehouseId) => {
            try {
              const task = await api.sales.startPicking({ invoice_id: invoiceId, warehouse_id: warehouseId });
              await load();
              setModal({ kind: 'pick', taskId: task.id });
            } catch (err: any) {
              await alertError('Could not start picking', err.message);
            }
          }}
          onCollect={(taskId) => setModal({ kind: 'collect', taskId })}
          onViewInvoice={(id) => setViewInvoiceId(id)}
          onDone={() => void load()}
        />
      )}

      <div className="cust-bal__cards">
        {cards.map((c) => (
          <button
            key={c.label}
            type="button"
            className="card-surface cust-bal__card"
            style={{ textAlign: 'left', cursor: c.tab ? 'pointer' : 'default', border: 'none' }}
            onClick={() => c.tab && setTab(c.tab)}
          >
            <div className="cust-bal__card-label">{c.label}</div>
            <div className="cust-bal__card-value" style={c.tone === 'warn' && c.value ? { color: 'var(--accent)' } : undefined}>
              {c.value}
            </div>
          </button>
        ))}
      </div>

      <div className="card-surface" style={{ padding: '0.5rem 0' }}>
        <div className="cust-bal__toolbar">
          <div className="segmented" role="tablist">
            {(
              [
                ['to_pick', `To pick${data.awaiting.length ? ` (${data.awaiting.length})` : ''}`],
                ['picking', `Picking${tasksBy.picking.length ? ` (${tasksBy.picking.length})` : ''}`],
                ['ready', `Ready${tasksBy.ready.length ? ` (${tasksBy.ready.length})` : ''}`],
                ['delivery', `Delivery${tasksBy.delivery.length ? ` (${tasksBy.delivery.length})` : ''}`],
                ['done', 'Completed'],
                ['issues', 'Discrepancies']
              ] as [Tab, string][]
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                className={`segmented__btn${tab === id ? ' is-active' : ''}`}
                onClick={() => setTab(id)}
              >
                {label}
              </button>
            ))}
          </div>
          <select value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)} aria-label="Warehouse" style={{ maxWidth: 280 }}>
            <option value="">All my warehouses</option>
            {data.warehouses.map((w) => (
              <option key={w.id} value={w.id}>
                {w.branch?.name} · {w.code} — {w.name}
              </option>
            ))}
          </select>
          <label className="pickups__search">
            <Search size={15} />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Order #, FUL #, customer or phone" />
          </label>
          <button type="button" className="btn btn-ghost" onClick={() => void load()} disabled={loading}>
            <RefreshCw size={15} /> Refresh
          </button>
        </div>

        {tab === 'to_pick' ? (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Order</th>
                  <th>Customer</th>
                  <th>Sold at</th>
                  <th>From</th>
                  <th>To pick</th>
                  <th>Hold until</th>
                  <th>Payment</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {data.awaiting.map((r) => (
                  <tr key={`${r.invoice_id}:${r.warehouse?.id}`}>
                    <td>
                      {invoiceCell(r, r.invoice_id, r.invoice_number)}
                      {r.fulfilment_status === 'partial' ? <div className="line-items__discount-note">part fulfilled</div> : null}
                    </td>
                    <td>
                      <div style={{ fontWeight: 600 }}>{r.customer?.name}</div>
                      {r.customer?.phone ? <div className="line-items__discount-note">{r.customer.phone}</div> : null}
                    </td>
                    <td>{r.selling_branch?.name || '—'}</td>
                    <td>
                      {r.warehouse?.name}
                      <div className="line-items__discount-note">{r.warehouse?.branch?.name}</div>
                    </td>
                    <td>
                      {(r.lines || [])
                        .slice(0, 3)
                        .map((l: any) => `${qty(l.to_pick)} ${l.uom?.code || ''} ${l.product?.name}`)
                        .join(', ')}
                      {(r.lines || []).length > 3 ? ` +${r.lines.length - 3} more` : ''}
                    </td>
                    <td>{fmtDate(r.reservation_expires_at)}</td>
                    <td>
                      <span className={`invoice-chip invoice-chip--${r.payment_status}`}>
                        {PAYMENT_LABELS[r.payment_status] || r.payment_status}
                      </span>
                    </td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      {canPick ? (
                        <button type="button" className="btn btn-primary" onClick={() => void startPicking(r)}>
                          <ClipboardList size={15} /> Pick
                        </button>
                      ) : null}{' '}
                      {canRelease && r.fulfilment_mode !== 'delivery' ? (
                        <button type="button" className="btn btn-ghost" onClick={() => setModal({ kind: 'quick', row: r })}>
                          <PackageCheck size={15} /> Release now
                        </button>
                      ) : null}
                    </td>
                  </tr>
                ))}
                {!data.awaiting.length ? (
                  <tr>
                    <td colSpan={8} style={{ textAlign: 'center', color: 'var(--ink-muted)', padding: '2rem' }}>
                      {loading ? 'Loading…' : 'Nothing waiting to be picked.'}
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        ) : null}

        {tab === 'picking'
          ? taskTable(tasksBy.picking, 'No picking in progress.', (t) => (
              <>
                {canPick ? (
                  <button type="button" className="btn btn-primary" onClick={() => setModal({ kind: 'pick', taskId: t.id })}>
                    Record picking
                  </button>
                ) : null}{' '}
                {canPick ? (
                  <button type="button" className="btn btn-ghost" onClick={() => void cancelTask(t)}>
                    Cancel
                  </button>
                ) : null}
              </>
            ))
          : null}

        {tab === 'ready'
          ? taskTable(tasksBy.ready, 'Nothing is waiting for collection.', (t) => (
              <>
                {canRelease ? (
                  <button type="button" className="btn btn-primary" onClick={() => setModal({ kind: 'collect', taskId: t.id })}>
                    <PackageCheck size={15} /> Hand over
                  </button>
                ) : null}{' '}
                {canPick || canRelease ? (
                  <button type="button" className="btn btn-ghost" onClick={() => void cancelTask(t)}>
                    Put back
                  </button>
                ) : null}
              </>
            ))
          : null}

        {tab === 'delivery'
          ? taskTable(tasksBy.delivery, 'No deliveries waiting or on the road.', (t) =>
              canDispatch ? (
                t.status === 'picked' ? (
                  <>
                    <button type="button" className="btn btn-primary" onClick={() => setModal({ kind: 'dispatch', task: t })}>
                      <Truck size={15} /> Dispatch
                    </button>{' '}
                    <button type="button" className="btn btn-ghost" onClick={() => void cancelTask(t)}>
                      Put back
                    </button>
                  </>
                ) : (
                  <button type="button" className="btn btn-primary" onClick={() => setModal({ kind: 'deliver', taskId: t.id })}>
                    Confirm delivery
                  </button>
                )
              ) : null
            )
          : null}

        {tab === 'done' ? taskTable(tasksBy.done, 'No completed hand-overs in the last 30 days.', () => null) : null}
        {tab === 'issues' ? taskTable(tasksBy.issues, 'No discrepancies in the last 30 days.', () => null) : null}
      </div>

      {modal?.kind === 'quick' ? (
        <QuickReleaseModal
          row={modal.row}
          onClose={() => setModal(null)}
          onDone={async () => {
            setModal(null);
            setCodePanelKey((k) => k + 1);
            await load();
          }}
        />
      ) : null}
      {modal?.kind === 'pick' ? (
        <PickModal taskId={modal.taskId} onClose={() => setModal(null)} onDone={async () => { setModal(null); await load(); }} />
      ) : null}
      {modal?.kind === 'collect' ? (
        <CollectModal
          taskId={modal.taskId}
          onClose={() => setModal(null)}
          onDone={async () => {
            setModal(null);
            setCodePanelKey((k) => k + 1);
            await load();
          }}
        />
      ) : null}
      {modal?.kind === 'dispatch' ? (
        <DispatchModal task={modal.task} vehicles={vehicles} onClose={() => setModal(null)} onDone={async () => { setModal(null); await load(); }} />
      ) : null}
      {modal?.kind === 'deliver' ? (
        <DeliverModal taskId={modal.taskId} onClose={() => setModal(null)} onDone={async () => { setModal(null); await load(); }} />
      ) : null}

      {viewInvoiceId ? <InvoiceViewModal invoiceId={viewInvoiceId} onClose={() => setViewInvoiceId(null)} /> : null}
    </div>
  );
};

// ─── shared modal shell ─────────────────────────────────────────────────────

const ModalShell: React.FC<{
  eyebrow: string;
  title: string;
  onClose: () => void;
  onSubmit: (e: React.FormEvent) => void;
  footer: React.ReactNode;
  children: React.ReactNode;
}> = ({ eyebrow, title, onClose, onSubmit, footer, children }) => {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    document.body.classList.add('modal-open');
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.classList.remove('modal-open');
    };
  }, [onClose]);
  return createPortal(
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <form className="modal invoice-view" role="dialog" aria-modal="true" onSubmit={onSubmit}>
        <div className="modal__header">
          <div>
            <div className="invoice-view__eyebrow">{eyebrow}</div>
            <h2 className="display invoice-view__number">{title}</h2>
          </div>
          <div className="modal__actions">
            <button type="button" className="line-items__remove" onClick={onClose} aria-label="Close">
              <X size={18} />
            </button>
          </div>
        </div>
        <div className="modal__body">{children}</div>
        <div className="modal__footer">{footer}</div>
      </form>
    </div>,
    document.body
  );
};

function useTask(taskId: string) {
  const [task, setTask] = useState<any | null>(null);
  useEffect(() => {
    api.sales
      .fulfilment(taskId)
      .then(setTask)
      .catch((err) => void alertError('Fulfilment', err.message));
  }, [taskId]);
  return task;
}

const Loading: React.FC<{ onClose: () => void }> = ({ onClose }) => (
  <ModalShell eyebrow="Loading" title="…" onClose={onClose} onSubmit={(e) => e.preventDefault()} footer={null}>
    <p style={{ color: 'var(--ink-muted)' }}>Loading…</p>
  </ModalShell>
);

// ─── collector verification form (pickup code, collector, acknowledgement) ──

type Collector = {
  pickup_code: string;
  override: boolean;
  override_reason: string;
  collected_by: string;
  collector_relation: string;
  collector_phone: string;
  id_type: string;
  id_reference: string;
  signature_name: string;
  proof_reference: string;
  acknowledged: boolean;
  notes: string;
};

function emptyCollector(customer: any): Collector {
  return {
    pickup_code: '',
    override: false,
    override_reason: '',
    collected_by: customer?.name || '',
    collector_relation: 'customer',
    collector_phone: customer?.phone || '',
    id_type: '',
    id_reference: '',
    signature_name: '',
    proof_reference: '',
    acknowledged: false,
    notes: ''
  };
}

function collectorPayload(c: Collector) {
  return {
    ...(c.override ? { override_reason: c.override_reason } : { pickup_code: c.pickup_code }),
    collected_by: c.collected_by,
    collector_relation: c.collector_relation,
    collector_phone: c.collector_phone || undefined,
    id_type: c.id_type || undefined,
    id_reference: c.id_reference || undefined,
    signature_name: c.signature_name || undefined,
    proof_reference: c.proof_reference || undefined,
    acknowledged: c.acknowledged,
    notes: c.notes || undefined
  };
}

const CollectorFields: React.FC<{
  value: Collector;
  onChange: (c: Collector) => void;
  hasCode: boolean;
  authorised: { name: string; phone?: string | null }[];
}> = ({ value, onChange, hasCode, authorised }) => {
  const { can } = useAuth();
  const canOverride = can('fulfilment.override_pickup_code');
  const set = (patch: Partial<Collector>) => onChange({ ...value, ...patch });
  return (
    <>
      {hasCode ? (
        <div className="form-grid">
          <div className="field">
            <label>Pickup code</label>
            <input
              value={value.pickup_code}
              onChange={(e) => set({ pickup_code: e.target.value })}
              placeholder="6-digit code from the customer"
              inputMode="numeric"
              autoComplete="off"
              disabled={value.override}
              required={!value.override}
            />
          </div>
          {canOverride ? (
            <div className="field">
              <label>
                <input
                  type="checkbox"
                  checked={value.override}
                  onChange={(e) => set({ override: e.target.checked })}
                  style={{ width: 'auto', marginRight: 6 }}
                />
                Release without the code (supervisor)
              </label>
              {value.override ? (
                <input
                  value={value.override_reason}
                  onChange={(e) => set({ override_reason: e.target.value })}
                  placeholder="Reason, e.g. code lost — identity checked"
                  required
                />
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}

      {authorised.length ? (
        <div className="line-items__discount-note" style={{ margin: '0.5rem 0' }}>
          Authorised collectors: {authorised.map((a) => a.name + (a.phone ? ` (${a.phone})` : '')).join(', ')}
        </div>
      ) : null}

      <div className="form-grid">
        <div className="field">
          <label>Collected by</label>
          <input value={value.collected_by} onChange={(e) => set({ collected_by: e.target.value })} required />
        </div>
        <div className="field">
          <label>Collector is</label>
          <select value={value.collector_relation} onChange={(e) => set({ collector_relation: e.target.value })}>
            <option value="customer">The customer</option>
            {authorised.length ? <option value="authorised">An authorised collector</option> : null}
            <option value="other">Someone else (sent by the customer)</option>
          </select>
        </div>
        <div className="field">
          <label>Phone</label>
          <input value={value.collector_phone} onChange={(e) => set({ collector_phone: e.target.value })} />
        </div>
        <div className="field">
          <label>ID checked</label>
          <select value={value.id_type} onChange={(e) => set({ id_type: e.target.value })}>
            {ID_TYPES.map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        </div>
        {value.id_type ? (
          <div className="field">
            <label>ID number (only the last 4 characters are kept)</label>
            <input value={value.id_reference} onChange={(e) => set({ id_reference: e.target.value })} autoComplete="off" />
          </div>
        ) : null}
        <div className="field">
          <label>Signed by</label>
          <input value={value.signature_name} onChange={(e) => set({ signature_name: e.target.value })} placeholder="Name as signed" />
        </div>
        <div className="field">
          <label>Proof reference</label>
          <input
            value={value.proof_reference}
            onChange={(e) => set({ proof_reference: e.target.value })}
            placeholder="Signed slip no. or photo link (optional)"
          />
        </div>
        <div className="field">
          <label>Notes</label>
          <input value={value.notes} onChange={(e) => set({ notes: e.target.value })} placeholder="Optional" />
        </div>
      </div>
      <label style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: '0.75rem', fontWeight: 600 }}>
        <input
          type="checkbox"
          checked={value.acknowledged}
          onChange={(e) => set({ acknowledged: e.target.checked })}
          style={{ width: 'auto' }}
        />
        The collector checked the goods and acknowledged receipt
      </label>
    </>
  );
};

/** Upload collection / delivery photos or PDFs to S3 via the fulfilment proofs API. */
const ProofUploader: React.FC<{
  taskId: string;
  kind: 'collection' | 'delivery';
  proofs: any[];
  onChange: (proofs: any[]) => void;
  onPrimaryUrl?: (url: string) => void;
}> = ({ taskId, kind, proofs, onChange, onPrimaryUrl }) => {
  const [busy, setBusy] = useState(false);
  const upload = async (file: File | null) => {
    if (!file) return;
    setBusy(true);
    try {
      const row = await api.sales.uploadFulfilmentProof(taskId, file, kind);
      const next = [row, ...proofs];
      onChange(next);
      if (onPrimaryUrl && next[0]?.url) onPrimaryUrl(next[0].url);
    } catch (err: any) {
      await alertError('Upload failed', err.message);
    } finally {
      setBusy(false);
    }
  };
  const remove = async (proofId: string) => {
    setBusy(true);
    try {
      await api.sales.deleteFulfilmentProof(taskId, proofId);
      const next = proofs.filter((p) => p.id !== proofId);
      onChange(next);
      if (onPrimaryUrl) onPrimaryUrl(next[0]?.url || '');
    } catch (err: any) {
      await alertError('Could not remove proof', err.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div style={{ marginTop: '0.75rem' }}>
      <div className="field">
        <label>{kind === 'delivery' ? 'Proof of delivery photo / PDF' : 'Collection proof photo / PDF'}</label>
        <input
          type="file"
          accept="image/jpeg,image/png,image/webp,image/gif,application/pdf"
          disabled={busy}
          onChange={(e) => {
            const f = e.target.files?.[0] || null;
            e.target.value = '';
            void upload(f);
          }}
        />
        <div className="line-items__discount-note">JPEG, PNG, WebP, GIF or PDF · max 8 MB · stored on S3</div>
      </div>
      {proofs.length ? (
        <ul style={{ listStyle: 'none', padding: 0, margin: '0.5rem 0 0', display: 'grid', gap: 8 }}>
          {proofs.map((p) => (
            <li
              key={p.id}
              style={{
                display: 'flex',
                gap: 10,
                alignItems: 'center',
                padding: '0.4rem 0.6rem',
                background: 'var(--surface-2, #f4f4f2)',
                borderRadius: 6
              }}
            >
              {String(p.mime_type || '').startsWith('image/') ? (
                <a href={p.url} target="_blank" rel="noreferrer">
                  <img src={p.url} alt="" style={{ width: 48, height: 48, objectFit: 'cover', borderRadius: 4 }} />
                </a>
              ) : (
                <a href={p.url} target="_blank" rel="noreferrer" className="btn-linkish">
                  PDF
                </a>
              )}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.file_name}</div>
                <div className="line-items__discount-note">{p.kind}</div>
              </div>
              <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => void remove(p.id)}>
                Remove
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
};

function QtyInput({ value, max, onChange }: { value: string; max: number; onChange: (v: string) => void }) {
  const v = Number(value || 0);
  const bad = !Number.isFinite(v) || v < 0 || v > max + 1e-9;
  return (
    <input
      type="number"
      min="0"
      max={max}
      step="any"
      className="qty-input"
      value={value}
      aria-invalid={bad}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

/** Customer quotes pickup code — find order and release what is reserved at this branch. */
const CodeLookupBar: React.FC<{
  canRelease: boolean;
  canPick: boolean;
  onQuick: (row: any) => void;
  onPick: (invoiceId: string, warehouseId: string) => Promise<void>;
  onCollect: (taskId: string) => void;
  onViewInvoice: (id: string) => void;
  onDone: () => void;
}> = ({ canRelease, canPick, onQuick, onPick, onCollect, onViewInvoice, onDone }) => {
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [hit, setHit] = useState<any | null>(null);

  const lookup = async (e?: React.FormEvent) => {
    e?.preventDefault();
    const c = code.replace(/\s+/g, '');
    if (!c) return;
    setBusy(true);
    try {
      setHit(await api.sales.lookupPickupByCode(c));
    } catch (err: any) {
      setHit(null);
      await alertError('Pickup code', err.message);
    } finally {
      setBusy(false);
    }
  };

  const toQuickRow = (loc: any) => ({
    invoice_id: hit.invoice_id,
    invoice_number: hit.invoice_number,
    amount_due: hit.amount_due,
    has_pickup_code: true,
    suggested_pickup_code: code.replace(/\s+/g, ''),
    authorised_collectors: hit.authorised_collectors || [],
    customer: hit.customer,
    warehouse: loc.warehouse,
    lines: (loc.lines || []).map((l: any) => ({
      invoice_item_id: l.invoice_item_id,
      product: l.product,
      variant: l.variant,
      uom: l.uom,
      quantity: l.ordered,
      fulfilled_quantity: l.collected,
      to_pick: l.to_collect
    }))
  });

  return (
    <div className="card-surface" style={{ padding: '1rem 1.25rem', display: 'grid', gap: 12 }}>
      <div>
        <div style={{ fontWeight: 700 }}>Customer with a pickup code</div>
        <div className="line-items__discount-note">
          Works at any branch that holds reserved stock. Part collect now — same code for the balance later or at another
          branch.
        </div>
      </div>
      <form onSubmit={(e) => void lookup(e)} style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
        <input
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/[^\d\s]/g, '').slice(0, 10))}
          placeholder="6-digit code"
          inputMode="numeric"
          autoComplete="one-time-code"
          style={{ width: 140, letterSpacing: '0.12em', fontWeight: 700 }}
          aria-label="Pickup code"
        />
        <button type="submit" className="btn btn-primary" disabled={busy || !code.trim()}>
          {busy ? 'Looking up…' : 'Find order'}
        </button>
        {hit ? (
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => {
              setHit(null);
              setCode('');
              onDone();
            }}
          >
            Clear
          </button>
        ) : null}
      </form>

      {hit ? (
        <div style={{ display: 'grid', gap: 12 }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'baseline' }}>
            <button type="button" className="btn-linkish" style={{ fontWeight: 700, fontSize: '1.05rem' }} onClick={() => onViewInvoice(hit.invoice_id)}>
              {hit.invoice_number}
            </button>
            <span className={`invoice-chip invoice-chip--${hit.fulfilment_status}`}>{hit.fulfilment_status}</span>
            <span>
              {hit.customer?.name}
              {hit.customer?.phone ? ` · ${hit.customer.phone}` : ''}
            </span>
            <span className="line-items__discount-note">Sold at {hit.selling_branch?.name || '—'}</span>
          </div>
          <div className="line-items__discount-note">{hit.message}</div>

          {(hit.collect_here || []).length ? (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Collect here</th>
                    <th>Lines</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {hit.collect_here.map((loc: any) => (
                    <tr key={loc.warehouse.id}>
                      <td>
                        <div style={{ fontWeight: 600 }}>{loc.warehouse.name}</div>
                        <div className="line-items__discount-note">{loc.warehouse.branch?.name}</div>
                      </td>
                      <td>
                        {(loc.lines || [])
                          .map(
                            (l: any) =>
                              `${qty(l.to_collect)} ${l.uom?.code || ''} ${l.product?.name}${
                                l.variant?.name ? ` (${l.variant.name})` : ''
                              }`
                          )
                          .join(' · ')}
                      </td>
                      <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                        {loc.ready_task_id && canRelease ? (
                          <button type="button" className="btn btn-primary" onClick={() => onCollect(loc.ready_task_id)}>
                            Hand over
                          </button>
                        ) : null}
                        {!loc.ready_task_id && canRelease ? (
                          <button type="button" className="btn btn-primary" onClick={() => onQuick(toQuickRow(loc))}>
                            Release now
                          </button>
                        ) : null}
                        {!loc.ready_task_id && canPick ? (
                          <button
                            type="button"
                            className="btn btn-ghost"
                            style={{ marginLeft: 6 }}
                            onClick={() => void onPick(hit.invoice_id, loc.warehouse.id)}
                          >
                            Start picking
                          </button>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}

          {(hit.elsewhere || []).length ? (
            <div className="pickups__warning">
              Also reserved elsewhere (customer can use the same code there):{' '}
              {(hit.elsewhere as any[])
                .map(
                  (loc) =>
                    `${loc.warehouse.branch?.name || ''} · ${loc.warehouse.name} (${(loc.lines || [])
                      .map((l: any) => `${qty(l.to_collect)} ${l.uom?.code || ''}`)
                      .join(', ')})`
                )
                .join(' · ')}
            </div>
          ) : null}

          {(hit.lines || []).some((l: any) => Number(l.backordered) > 1e-9) ? (
            <div className="line-items__discount-note">
              Backordered:{' '}
              {(hit.lines as any[])
                .filter((l) => Number(l.backordered) > 1e-9)
                .map((l) => `${qty(l.backordered)} ${l.uom?.code || ''} ${l.product?.name}`)
                .join(' · ')}
              . Allocate stock before the customer can collect that balance.
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
};

// ─── quick release (no picking step) ───────────────────────────────────────

const QuickReleaseModal: React.FC<{ row: any; onClose: () => void; onDone: () => Promise<void> | void }> = ({ row, onClose, onDone }) => {
  const lines: any[] = row.lines || [];
  const [quantities, setQuantities] = useState<Record<string, string>>(() =>
    Object.fromEntries(lines.map((l) => [l.invoice_item_id, String(l.to_pick)]))
  );
  const [collector, setCollector] = useState<Collector>(() => ({
    ...emptyCollector(row.customer),
    pickup_code: row.suggested_pickup_code || ''
  }));
  const [busy, setBusy] = useState(false);
  const invalid = lines.some((l) => {
    const v = Number(quantities[l.invoice_item_id] || 0);
    return !Number.isFinite(v) || v < 0 || v > Number(l.to_pick) + 1e-9;
  });
  const anyQty = lines.some((l) => Number(quantities[l.invoice_item_id] || 0) > 0);
  const due = Number(row.amount_due ?? 0);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (invalid || !anyQty) return;
    setBusy(true);
    try {
      const res = await api.sales.fulfil({
        invoice_id: row.invoice_id,
        warehouse_id: row.warehouse?.id,
        ...collectorPayload(collector),
        items: lines
          .map((l) => ({ invoice_item_id: l.invoice_item_id, quantity: Number(quantities[l.invoice_item_id] || 0) }))
          .filter((i) => i.quantity > 0)
      });
      const left = lines.some(
        (l) => Number(quantities[l.invoice_item_id] || 0) < Number(l.to_pick) - 1e-9
      );
      await alertSuccess(
        `${res.fulfilment_number} released`,
        left
          ? `${row.invoice_number}: part collected. Customer can return with the same pickup code for the balance.`
          : `${row.invoice_number}: goods handed to ${collector.collected_by}.`
      );
      await onDone();
    } catch (err: any) {
      await alertError('Release failed', err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <ModalShell
      eyebrow={`Release now · ${row.warehouse?.name}`}
      title={row.invoice_number}
      onClose={onClose}
      onSubmit={submit}
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary" disabled={busy || invalid || !anyQty || !collector.acknowledged}>
            {busy ? 'Releasing…' : 'Release goods'}
          </button>
        </>
      }
    >
      {due > 0 ? (
        <div className="pickups__warning">
          This order still has {due.toLocaleString(undefined, { minimumFractionDigits: 2 })} unpaid. Release only if the
          customer is cleared to collect on credit.
        </div>
      ) : null}
      <div className="line-items">
        <div className="line-items__scroll">
          <table className="line-items__table">
            <thead>
              <tr>
                <th>Product</th>
                <th>UoM</th>
                <th className="num">Ordered</th>
                <th className="num">Collected</th>
                <th className="num">Available here</th>
                <th className="line-items__col-qty" style={{ textAlign: 'center' }}>
                  Release now
                </th>
              </tr>
            </thead>
            <tbody>
              {lines.map((l) => (
                <tr key={l.invoice_item_id}>
                  <td>{lineLabel(l)}</td>
                  <td>{l.uom?.code || '—'}</td>
                  <td className="num">{qty(l.quantity)}</td>
                  <td className="num">{qty(l.fulfilled_quantity)}</td>
                  <td className="num">{qty(l.to_pick)}</td>
                  <td className="line-items__col-qty">
                    <QtyInput
                      value={quantities[l.invoice_item_id] ?? ''}
                      max={Number(l.to_pick)}
                      onChange={(v) => setQuantities((s) => ({ ...s, [l.invoice_item_id]: v }))}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <CollectorFields value={collector} onChange={setCollector} hasCode={Boolean(row.has_pickup_code)}
        authorised={Array.isArray(row.authorised_collectors) ? row.authorised_collectors : []}
      />
    </ModalShell>
  );
};

// ─── picking ────────────────────────────────────────────────────────────────

const PickModal: React.FC<{ taskId: string; onClose: () => void; onDone: () => Promise<void> | void }> = ({ taskId, onClose, onDone }) => {
  const task = useTask(taskId);
  const [picked, setPicked] = useState<Record<string, string>>({});
  const [damaged, setDamaged] = useState<Record<string, string>>({});
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!task) return;
    setPicked(Object.fromEntries(task.items.map((i: any) => [i.invoice_item_id, String(Number(i.planned_quantity))])));
    setDamaged(Object.fromEntries(task.items.map((i: any) => [i.invoice_item_id, '0'])));
  }, [task]);
  if (!task) return <Loading onClose={onClose} />;

  const rows = task.items.map((i: any) => {
    const planned = Number(i.planned_quantity);
    const p = Number(picked[i.invoice_item_id] || 0);
    const d = Number(damaged[i.invoice_item_id] || 0);
    return { i, planned, p, d, short: Math.max(0, planned - p - d), bad: p < 0 || d < 0 || p + d > planned + 1e-9 };
  });
  const invalid = rows.some((r: any) => r.bad);
  const shortTotal = rows.reduce((s: number, r: any) => s + r.short + r.d, 0);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (invalid) return;
    setBusy(true);
    try {
      const res = await api.sales.confirmPicking(taskId, {
        items: rows.map((r: any) => ({ invoice_item_id: r.i.invoice_item_id, picked_quantity: r.p, damaged_quantity: r.d })),
        discrepancy_notes: notes || undefined
      });
      await alertSuccess(
        `${res.fulfilment_number} ${STATUS_LABELS[res.status]?.toLowerCase() || res.status}`,
        res.status === 'picked'
          ? `Delivery ${res.delivery_order?.delivery_number || ''} is ready to dispatch.`
          : res.status === 'discrepancy'
            ? 'Nothing could be picked; the order owner has been told to reallocate.'
            : 'The customer can now collect with their pickup code.'
      );
      await onDone();
    } catch (err: any) {
      await alertError('Picking failed', err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <ModalShell
      eyebrow={`Picking list · ${task.warehouse?.name}`}
      title={`${task.fulfilment_number} — ${task.invoice?.invoice_number}`}
      onClose={onClose}
      onSubmit={submit}
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Close
          </button>
          <button type="submit" className="btn btn-primary" disabled={busy || invalid}>
            {busy ? 'Saving…' : 'Confirm picked'}
          </button>
        </>
      }
    >
      <div className="invoice-view__meta">
        <div>
          <div className="invoice-view__label">Customer</div>
          <div className="invoice-view__strong">{task.invoice?.customer?.name}</div>
        </div>
        <dl className="invoice-view__facts">
          <dt>Type</dt>
          <dd>{task.fulfilment_type === 'delivery' ? 'Delivery' : 'Customer pickup'}</dd>
          {task.invoice?.delivery_address ? (
            <>
              <dt>Deliver to</dt>
              <dd>{task.invoice.delivery_address}</dd>
            </>
          ) : null}
          <dt>Started</dt>
          <dd>{fmtDate(task.pick_started_at, true)}</dd>
        </dl>
      </div>
      <div className="line-items">
        <div className="line-items__scroll">
          <table className="line-items__table">
            <thead>
              <tr>
                <th>Product</th>
                <th>Lots / batches</th>
                <th className="num line-items__col-qty">To pick</th>
                <th className="line-items__col-qty" style={{ textAlign: 'center' }}>
                  Picked
                </th>
                <th className="line-items__col-qty" style={{ textAlign: 'center' }}>
                  Damaged
                </th>
                <th className="num line-items__col-qty">Missing</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r: any) => (
                <tr key={r.i.id}>
                  <td>
                    {lineLabel(r.i)}
                    {r.i.invoice_item?.product?.barcode ? (
                      <div className="invoice-view__sub">Barcode {r.i.invoice_item.product.barcode}</div>
                    ) : null}
                  </td>
                  <td style={{ fontSize: '0.8rem' }}>
                    {(r.i.lots || []).map((l: any) => (
                      <div key={l.lot_id}>
                        {l.batch_number || 'lot'} · {qty(l.quantity)}
                        {l.expiry_date ? ` · exp ${fmtDate(l.expiry_date)}` : ''}
                      </div>
                    ))}
                  </td>
                  <td className="num">
                    {qty(r.planned)} {r.i.invoice_item?.uom?.code}
                  </td>
                  <td className="line-items__col-qty">
                    <QtyInput
                      value={picked[r.i.invoice_item_id] ?? ''}
                      max={r.planned}
                      onChange={(v) => setPicked((s) => ({ ...s, [r.i.invoice_item_id]: v }))}
                    />
                  </td>
                  <td className="line-items__col-qty">
                    <QtyInput
                      value={damaged[r.i.invoice_item_id] ?? ''}
                      max={r.planned}
                      onChange={(v) => setDamaged((s) => ({ ...s, [r.i.invoice_item_id]: v }))}
                    />
                  </td>
                  <td className="num" style={r.short > 0 ? { color: 'var(--accent)', fontWeight: 600 } : undefined}>
                    {qty(r.short)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      {shortTotal > 0 ? (
        <>
          <div className="pickups__warning" style={{ marginTop: '0.75rem' }}>
            {qty(shortTotal)} will be released from the reservation as a discrepancy and become a backorder on the order.
          </div>
          <div className="field">
            <label>What happened?</label>
            <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. 1 carton crushed, bin empty" />
          </div>
        </>
      ) : null}
    </ModalShell>
  );
};

// ─── hand-over of a picked task ─────────────────────────────────────────────

const CollectModal: React.FC<{ taskId: string; onClose: () => void; onDone: () => Promise<void> | void }> = ({ taskId, onClose, onDone }) => {
  const task = useTask(taskId);
  const [quantities, setQuantities] = useState<Record<string, string>>({});
  const [collector, setCollector] = useState<Collector>(() => emptyCollector(null));
  const [proofs, setProofs] = useState<any[]>([]);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!task) return;
    setQuantities(Object.fromEntries(task.items.map((i: any) => [i.invoice_item_id, String(Number(i.picked_quantity))])));
    setCollector(emptyCollector(task.invoice?.customer));
    setProofs(task.proofs || []);
  }, [task]);
  if (!task) return <Loading onClose={onClose} />;

  const items: any[] = task.items.filter((i: any) => Number(i.picked_quantity) > 0);
  const invalid = items.some((i) => {
    const v = Number(quantities[i.invoice_item_id] || 0);
    return !Number.isFinite(v) || v < 0 || v > Number(i.picked_quantity) + 1e-9;
  });
  const anyQty = items.some((i) => Number(quantities[i.invoice_item_id] || 0) > 0);
  const partial = items.some((i) => Number(quantities[i.invoice_item_id] || 0) < Number(i.picked_quantity) - 1e-9);
  const due = Number(task.invoice?.amount_due || 0);
  const authorised = Array.isArray(task.invoice?.authorised_collectors) ? task.invoice.authorised_collectors : [];

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (invalid || !anyQty) return;
    setBusy(true);
    try {
      await api.sales.releaseFulfilment(taskId, {
        ...collectorPayload(collector),
        items: items.map((i) => ({ invoice_item_id: i.invoice_item_id, quantity: Number(quantities[i.invoice_item_id] || 0) }))
      });
      await alertSuccess(
        `${task.fulfilment_number} handed over`,
        partial ? 'The rest stays ready for collection on a new record.' : `${task.invoice?.invoice_number}: goods collected.`
      );
      await onDone();
    } catch (err: any) {
      await alertError('Hand-over failed', err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <ModalShell
      eyebrow={`Hand over · ${task.warehouse?.name}`}
      title={`${task.fulfilment_number} — ${task.invoice?.invoice_number}`}
      onClose={onClose}
      onSubmit={submit}
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary" disabled={busy || invalid || !anyQty || !collector.acknowledged}>
            {busy ? 'Releasing…' : partial ? 'Hand over part' : 'Hand over all'}
          </button>
        </>
      }
    >
      {due > 0 ? (
        <div className="pickups__warning">
          This order still has {due.toLocaleString(undefined, { minimumFractionDigits: 2 })} unpaid. Release only if the
          customer is cleared to collect on credit.
        </div>
      ) : null}
      <div className="line-items">
        <div className="line-items__scroll">
          <table className="line-items__table">
            <thead>
              <tr>
                <th>Product</th>
                <th>UoM</th>
                <th className="num">Picked</th>
                <th className="line-items__col-qty" style={{ textAlign: 'center' }}>
                  Hand over
                </th>
              </tr>
            </thead>
            <tbody>
              {items.map((i) => (
                <tr key={i.id}>
                  <td>{lineLabel(i)}</td>
                  <td>{i.invoice_item?.uom?.code || '—'}</td>
                  <td className="num">{qty(i.picked_quantity)}</td>
                  <td className="line-items__col-qty">
                    <QtyInput
                      value={quantities[i.invoice_item_id] ?? ''}
                      max={Number(i.picked_quantity)}
                      onChange={(v) => setQuantities((s) => ({ ...s, [i.invoice_item_id]: v }))}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <CollectorFields value={collector} onChange={setCollector} hasCode={Boolean(task.invoice?.has_pickup_code)} authorised={authorised} />
      <ProofUploader
        taskId={taskId}
        kind="collection"
        proofs={proofs}
        onChange={setProofs}
        onPrimaryUrl={(url) => setCollector((c) => ({ ...c, proof_reference: url || c.proof_reference }))}
      />
      {(task.verifications || []).some((v: any) => v.result !== 'success') ? (
        <div className="line-items__discount-note" style={{ marginTop: '0.5rem' }}>
          Recent code checks:{' '}
          {task.verifications
            .slice(0, 5)
            .map((v: any) => `${v.result} ${fmtDate(v.created_at, true)}`)
            .join(' · ')}
        </div>
      ) : null}
    </ModalShell>
  );
};

// ─── delivery ───────────────────────────────────────────────────────────────

const DispatchModal: React.FC<{ task: any; vehicles: any[]; onClose: () => void; onDone: () => Promise<void> | void }> = ({
  task,
  vehicles,
  onClose,
  onDone
}) => {
  const [vehicleId, setVehicleId] = useState('');
  const [driver, setDriver] = useState(task.delivery_order?.driver_name || '');
  const [busy, setBusy] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await api.sales.dispatchFulfilment(task.id, { vehicle_id: vehicleId || undefined, driver_name: driver || undefined });
      await alertSuccess(`${task.delivery_order?.delivery_number || task.fulfilment_number} dispatched`, 'Confirm delivery when the customer signs for it.');
      await onDone();
    } catch (err: any) {
      await alertError('Dispatch failed', err.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <ModalShell
      eyebrow={`Dispatch · ${task.warehouse?.name}`}
      title={`${task.fulfilment_number} — ${task.invoice?.invoice_number}`}
      onClose={onClose}
      onSubmit={submit}
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary" disabled={busy || (!vehicleId && !driver.trim())}>
            {busy ? 'Dispatching…' : 'Dispatch'}
          </button>
        </>
      }
    >
      <p style={{ marginTop: 0 }}>
        Deliver to <strong>{task.invoice?.delivery_address || task.invoice?.customer?.name}</strong>
      </p>
      <div className="form-grid">
        <div className="field">
          <label>Vehicle</label>
          <select value={vehicleId} onChange={(e) => setVehicleId(e.target.value)}>
            <option value="">— none / third-party —</option>
            {vehicles.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name}
                {v.plate_number ? ` · ${v.plate_number}` : ''}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label>Driver / transporter</label>
          <input value={driver} onChange={(e) => setDriver(e.target.value)} placeholder="Name" />
        </div>
      </div>
    </ModalShell>
  );
};

const DeliverModal: React.FC<{ taskId: string; onClose: () => void; onDone: () => Promise<void> | void }> = ({ taskId, onClose, onDone }) => {
  const task = useTask(taskId);
  const [quantities, setQuantities] = useState<Record<string, string>>({});
  const [form, setForm] = useState({ received_by: '', signature_name: '', proof_reference: '', pod_notes: '' });
  const [proofs, setProofs] = useState<any[]>([]);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!task) return;
    setQuantities(Object.fromEntries(task.items.map((i: any) => [i.invoice_item_id, String(Number(i.picked_quantity))])));
    setProofs(task.proofs || []);
    if (task.proof_reference || task.delivery_order?.pod_reference) {
      setForm((f) => ({
        ...f,
        proof_reference: f.proof_reference || task.proof_reference || task.delivery_order?.pod_reference || ''
      }));
    }
  }, [task]);
  if (!task) return <Loading onClose={onClose} />;
  const items: any[] = task.items.filter((i: any) => Number(i.picked_quantity) > 0);
  const invalid = items.some((i) => {
    const v = Number(quantities[i.invoice_item_id] || 0);
    return !Number.isFinite(v) || v < 0 || v > Number(i.picked_quantity) + 1e-9;
  });
  const returned = items.reduce((s, i) => s + Math.max(0, Number(i.picked_quantity) - Number(quantities[i.invoice_item_id] || 0)), 0);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (invalid) return;
    setBusy(true);
    try {
      await api.sales.deliverFulfilment(taskId, {
        ...form,
        items: items.map((i) => ({ invoice_item_id: i.invoice_item_id, quantity: Number(quantities[i.invoice_item_id] || 0) }))
      });
      await alertSuccess('Delivery confirmed', returned > 0 ? `${qty(returned)} came back and stays reserved for the order.` : 'All goods delivered.');
      await onDone();
    } catch (err: any) {
      await alertError('Delivery confirmation failed', err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <ModalShell
      eyebrow={`Proof of delivery · ${task.delivery_order?.delivery_number || ''}`}
      title={`${task.fulfilment_number} — ${task.invoice?.invoice_number}`}
      onClose={onClose}
      onSubmit={submit}
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary" disabled={busy || invalid || !form.received_by.trim()}>
            {busy ? 'Saving…' : 'Confirm delivery'}
          </button>
        </>
      }
    >
      <p style={{ marginTop: 0 }}>
        {task.invoice?.delivery_address}
        {task.delivery_order?.driver_name ? ` · driver ${task.delivery_order.driver_name}` : ''}
      </p>
      <div className="line-items">
        <div className="line-items__scroll">
          <table className="line-items__table">
            <thead>
              <tr>
                <th>Product</th>
                <th className="num">Dispatched</th>
                <th className="line-items__col-qty" style={{ textAlign: 'center' }}>
                  Delivered
                </th>
              </tr>
            </thead>
            <tbody>
              {items.map((i) => (
                <tr key={i.id}>
                  <td>{lineLabel(i)}</td>
                  <td className="num">
                    {qty(i.picked_quantity)} {i.invoice_item?.uom?.code}
                  </td>
                  <td className="line-items__col-qty">
                    <QtyInput
                      value={quantities[i.invoice_item_id] ?? ''}
                      max={Number(i.picked_quantity)}
                      onChange={(v) => setQuantities((s) => ({ ...s, [i.invoice_item_id]: v }))}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <div className="form-grid">
        <div className="field">
          <label>Received by</label>
          <input value={form.received_by} onChange={(e) => setForm({ ...form, received_by: e.target.value })} required />
        </div>
        <div className="field">
          <label>Signed by</label>
          <input value={form.signature_name} onChange={(e) => setForm({ ...form, signature_name: e.target.value })} />
        </div>
        <div className="field">
          <label>Proof of delivery reference</label>
          <input
            value={form.proof_reference}
            onChange={(e) => setForm({ ...form, proof_reference: e.target.value })}
            placeholder="Signed note no. or photo link"
          />
        </div>
        <div className="field">
          <label>Notes</label>
          <input value={form.pod_notes} onChange={(e) => setForm({ ...form, pod_notes: e.target.value })} placeholder="Optional" />
        </div>
      </div>
      <ProofUploader
        taskId={taskId}
        kind="delivery"
        proofs={proofs}
        onChange={setProofs}
        onPrimaryUrl={(url) => setForm((f) => ({ ...f, proof_reference: url || f.proof_reference }))}
      />
      {returned > 0 ? (
        <div className="pickups__warning" style={{ marginTop: '0.75rem' }}>
          {qty(returned)} not delivered — it returns to {task.warehouse?.name} and stays reserved for the order.
        </div>
      ) : null}
    </ModalShell>
  );
};
