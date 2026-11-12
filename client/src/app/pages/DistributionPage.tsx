import React, { useEffect, useState } from 'react';
import Swal from 'sweetalert2';
import { api } from '../utils/api';
import { alertError, alertSuccess } from '../utils/alerts';

type Tab = 'vehicles' | 'deliveries';

export const DistributionPage: React.FC = () => {
  const [tab, setTab] = useState<Tab>('deliveries');
  const [vehicles, setVehicles] = useState<any[]>([]);
  const [deliveries, setDeliveries] = useState<any[]>([]);
  const [customers, setCustomers] = useState<any[]>([]);
  const [warehouses, setWarehouses] = useState<any[]>([]);
  const [products, setProducts] = useState<any[]>([]);
  const [invoices, setInvoices] = useState<any[]>([]);
  const [vehicleForm, setVehicleForm] = useState({
    name: '',
    code: '',
    plate_number: '',
    capacity: '',
    status: 'available'
  });
  const [mode, setMode] = useState<'items' | 'invoice'>('items');
  const [deliveryForm, setDeliveryForm] = useState({
    customer_id: '',
    warehouse_id: '',
    product_id: '',
    quantity: '1',
    sales_invoice_id: '',
    vehicle_id: '',
    scheduled_date: new Date().toISOString().slice(0, 10),
    driver_name: ''
  });

  const load = async () => {
    try {
      const [v, d, c, w, p, inv] = await Promise.all([
        api.distribution.vehicles(),
        api.distribution.deliveries(),
        api.customers.list(undefined, undefined, { includeWalkIn: true }),
        api.warehouses.list(),
        api.products.list(),
        api.sales.invoices('posted')
      ]);
      setVehicles(v);
      setDeliveries(d);
      setCustomers(c);
      setWarehouses(w);
      setProducts(p);
      setInvoices(inv);
      setDeliveryForm((f) => ({
        ...f,
        customer_id: f.customer_id || c[0]?.id || '',
        warehouse_id: f.warehouse_id || w[0]?.id || '',
        product_id: f.product_id || p[0]?.id || '',
        sales_invoice_id: f.sales_invoice_id || inv[0]?.id || '',
        vehicle_id: f.vehicle_id || v[0]?.id || ''
      }));
    } catch (err: any) {
      await alertError('Distribution', err.message);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const createVehicle = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await api.distribution.createVehicle({
        name: vehicleForm.name,
        code: vehicleForm.code || undefined,
        plate_number: vehicleForm.plate_number || undefined,
        capacity: vehicleForm.capacity ? Number(vehicleForm.capacity) : undefined,
        status: vehicleForm.status
      });
      await alertSuccess('Vehicle created');
      setVehicleForm({ name: '', code: '', plate_number: '', capacity: '', status: 'available' });
      await load();
    } catch (err: any) {
      await alertError('Create failed', err.message);
    }
  };

  const createDelivery = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const body: Record<string, unknown> = {
        vehicle_id: deliveryForm.vehicle_id || undefined,
        scheduled_date: deliveryForm.scheduled_date || undefined,
        driver_name: deliveryForm.driver_name || undefined
      };
      if (mode === 'invoice') {
        body.sales_invoice_id = deliveryForm.sales_invoice_id;
      } else {
        body.customer_id = deliveryForm.customer_id;
        body.warehouse_id = deliveryForm.warehouse_id;
        body.items = [
          {
            product_id: deliveryForm.product_id,
            quantity: Number(deliveryForm.quantity)
          }
        ];
      }
      await api.distribution.createDelivery(body);
      await alertSuccess('Delivery created');
      await load();
      setTab('deliveries');
    } catch (err: any) {
      await alertError('Create failed', err.message);
    }
  };

  const act = async (
    action: 'schedule' | 'dispatch' | 'deliver' | 'cancel',
    id: string
  ) => {
    try {
      if (action === 'schedule') {
        await api.distribution.schedule(id, {
          vehicle_id: deliveryForm.vehicle_id || undefined,
          scheduled_date: deliveryForm.scheduled_date || undefined,
          driver_name: deliveryForm.driver_name || undefined
        });
      } else if (action === 'dispatch') {
        await api.distribution.dispatch(id, {
          vehicle_id: deliveryForm.vehicle_id || undefined,
          driver_name: deliveryForm.driver_name || undefined
        });
      } else if (action === 'deliver') {
        const pod = await Swal.fire({
          title: 'Proof of delivery',
          html:
            '<input id="pod-received" class="swal2-input" placeholder="Received by (name)">' +
            '<input id="pod-ref" class="swal2-input" placeholder="Signed note no. or photo link (optional)">',
          showCancelButton: true,
          confirmButtonText: 'Confirm delivered',
          confirmButtonColor: '#0f5c4c',
          preConfirm: () => {
            const received = (document.getElementById('pod-received') as HTMLInputElement)?.value.trim();
            if (!received) {
              Swal.showValidationMessage('Enter who received the goods');
              return false;
            }
            return { received_by: received, pod_reference: (document.getElementById('pod-ref') as HTMLInputElement)?.value.trim() || undefined };
          }
        });
        if (!pod.isConfirmed) return;
        await api.distribution.deliver(id, pod.value as Record<string, unknown>);
      } else {
        await api.distribution.cancel(id);
      }
      const labels = {
        schedule: 'scheduled',
        dispatch: 'dispatched',
        deliver: 'delivered',
        cancel: 'cancelled'
      } as const;
      await alertSuccess(`Delivery ${labels[action]}`);
      await load();
    } catch (err: any) {
      await alertError(`${action} failed`, err.message);
    }
  };

  return (
    <div className="page-stack">
      <header>
        <h1 className="display" style={{ margin: 0, fontSize: '2.2rem' }}>
          Distribution
        </h1>
        <p style={{ color: 'var(--ink-muted)', margin: '0.35rem 0 0' }}>
          Vehicles and delivery orders — schedule, dispatch, deliver.
        </p>
      </header>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {(
          [
            ['vehicles', 'Vehicles'],
            ['deliveries', 'Deliveries']
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

      {tab === 'vehicles' ? (
        <>
          <form
            onSubmit={createVehicle}
            className="card-surface"
            style={{ padding: '1.25rem', display: 'grid', gap: 12 }}
          >
            <div style={{ fontWeight: 700 }}>Add vehicle</div>
            <div className="form-grid">
              <div className="field">
                <label>Name</label>
                <input
                  value={vehicleForm.name}
                  onChange={(e) => setVehicleForm({ ...vehicleForm, name: e.target.value })}
                  required
                />
              </div>
              <div className="field">
                <label>Code</label>
                <input
                  value={vehicleForm.code}
                  onChange={(e) => setVehicleForm({ ...vehicleForm, code: e.target.value })}
                />
              </div>
              <div className="field">
                <label>Plate</label>
                <input
                  value={vehicleForm.plate_number}
                  onChange={(e) => setVehicleForm({ ...vehicleForm, plate_number: e.target.value })}
                />
              </div>
              <div className="field">
                <label>Capacity</label>
                <input
                  type="number"
                  min="0"
                  step="any"
                  value={vehicleForm.capacity}
                  onChange={(e) => setVehicleForm({ ...vehicleForm, capacity: e.target.value })}
                />
              </div>
              <div className="form-grid--actions">
                <button className="btn btn-primary" type="submit">
                  Create vehicle
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
                  <th>Code</th>
                  <th>Plate</th>
                  <th>Capacity</th>
                  <th>Driver</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {vehicles.map((v) => (
                  <tr key={v.id}>
                    <td>{v.name}</td>
                    <td>{v.code || '—'}</td>
                    <td>{v.plate_number || '—'}</td>
                    <td>{v.capacity != null ? Number(v.capacity).toLocaleString() : '—'}</td>
                    <td>{v.driver?.full_name || '—'}</td>
                    <td>{v.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          </div>
        </>
      ) : null}

      {tab === 'deliveries' ? (
        <>
          <form
            onSubmit={createDelivery}
            className="card-surface"
            style={{ padding: '1.25rem', display: 'grid', gap: 12 }}
          >
            <div style={{ fontWeight: 700 }}>New delivery</div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                type="button"
                className={mode === 'items' ? 'btn btn-primary' : 'btn btn-ghost'}
                onClick={() => setMode('items')}
              >
                From items
              </button>
              <button
                type="button"
                className={mode === 'invoice' ? 'btn btn-primary' : 'btn btn-ghost'}
                onClick={() => setMode('invoice')}
              >
                From invoice
              </button>
            </div>
            <div className="form-grid">
              {mode === 'invoice' ? (
                <div className="field">
                  <label>Sales invoice</label>
                  <select
                    value={deliveryForm.sales_invoice_id}
                    onChange={(e) =>
                      setDeliveryForm({ ...deliveryForm, sales_invoice_id: e.target.value })
                    }
                    required
                  >
                    {invoices.map((inv) => (
                      <option key={inv.id} value={inv.id}>
                        {inv.invoice_number} — {inv.customer?.name || ''}
                      </option>
                    ))}
                  </select>
                </div>
              ) : (
                <>
                  <div className="field">
                    <label>Customer</label>
                    <select
                      value={deliveryForm.customer_id}
                      onChange={(e) =>
                        setDeliveryForm({ ...deliveryForm, customer_id: e.target.value })
                      }
                      required
                    >
                      {customers.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="field">
                    <label>Warehouse</label>
                    <select
                      value={deliveryForm.warehouse_id}
                      onChange={(e) =>
                        setDeliveryForm({ ...deliveryForm, warehouse_id: e.target.value })
                      }
                      required
                    >
                      {warehouses.map((w) => (
                        <option key={w.id} value={w.id}>
                          {w.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="field">
                    <label>Product</label>
                    <select
                      value={deliveryForm.product_id}
                      onChange={(e) =>
                        setDeliveryForm({ ...deliveryForm, product_id: e.target.value })
                      }
                      required
                    >
                      {products.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="field">
                    <label>Qty</label>
                    <input
                      type="number"
                      min="0.01"
                      step="any"
                      value={deliveryForm.quantity}
                      onChange={(e) =>
                        setDeliveryForm({ ...deliveryForm, quantity: e.target.value })
                      }
                      required
                    />
                  </div>
                </>
              )}
              <div className="field">
                <label>Vehicle</label>
                <select
                  value={deliveryForm.vehicle_id}
                  onChange={(e) => setDeliveryForm({ ...deliveryForm, vehicle_id: e.target.value })}
                >
                  <option value="">—</option>
                  {vehicles.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label>Scheduled date</label>
                <input
                  type="date"
                  value={deliveryForm.scheduled_date}
                  onChange={(e) =>
                    setDeliveryForm({ ...deliveryForm, scheduled_date: e.target.value })
                  }
                />
              </div>
              <div className="field">
                <label>Driver name</label>
                <input
                  value={deliveryForm.driver_name}
                  onChange={(e) =>
                    setDeliveryForm({ ...deliveryForm, driver_name: e.target.value })
                  }
                />
              </div>
              <div className="form-grid--actions">
                <button className="btn btn-primary" type="submit">
                  Create delivery
                </button>
              </div>
            </div>
          </form>

          <div className="card-surface" style={{ padding: '0.5rem 0' }}>
            <div className="table-wrap">
              <table className="table">
              <thead>
                <tr>
                  <th>Delivery #</th>
                  <th>Customer</th>
                  <th>Invoice</th>
                  <th>Vehicle</th>
                  <th>Status</th>
                  <th>Scheduled</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {deliveries.map((d) => (
                  <tr key={d.id}>
                    <td>{d.delivery_number}</td>
                    <td>{d.customer?.name || '—'}</td>
                    <td>{d.sales_invoice?.invoice_number || '—'}</td>
                    <td>{d.vehicle?.name || '—'}</td>
                    <td>{d.status}</td>
                    <td>
                      {d.scheduled_date ? String(d.scheduled_date).slice(0, 10) : '—'}
                    </td>
                    <td>
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                        {['draft', 'scheduled'].includes(d.status) ? (
                          <button
                            type="button"
                            className="btn btn-ghost"
                            onClick={() => void act('schedule', d.id)}
                          >
                            Schedule
                          </button>
                        ) : null}
                        {['draft', 'scheduled'].includes(d.status) ? (
                          <button
                            type="button"
                            className="btn btn-ghost"
                            onClick={() => void act('dispatch', d.id)}
                          >
                            Dispatch
                          </button>
                        ) : null}
                        {d.status === 'dispatched' ? (
                          <button
                            type="button"
                            className="btn btn-ghost"
                            onClick={() => void act('deliver', d.id)}
                          >
                            Deliver
                          </button>
                        ) : null}
                        {!['delivered', 'cancelled'].includes(d.status) ? (
                          <button
                            type="button"
                            className="btn btn-ghost"
                            onClick={() => void act('cancel', d.id)}
                          >
                            Cancel
                          </button>
                        ) : null}
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
    </div>
  );
};
