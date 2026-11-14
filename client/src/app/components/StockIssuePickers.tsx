import React, { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../utils/api';

export type LotOption = {
  lot_id?: string;
  lotId?: string;
  id?: string;
  batch_number?: string | null;
  batchNumber?: string | null;
  expiry_date?: string | null;
  expiryDate?: string | null;
  available?: number;
};

export type SerialOption = {
  serial_number?: string;
  serialNumber?: string;
  lot_id?: string | null;
  lotId?: string | null;
  batch_number?: string | null;
  batchNumber?: string | null;
  expiry_date?: string | null;
  expiryDate?: string | null;
};

function lotIdOf(l: LotOption) {
  return l.lot_id || l.lotId || l.id || '';
}
function serialOf(s: SerialOption) {
  return s.serial_number || s.serialNumber || '';
}
function lotLabel(l: LotOption) {
  const batch = l.batch_number || l.batchNumber || 'BULK';
  const exp = l.expiry_date || l.expiryDate;
  const avail = l.available != null ? ` · ${l.available} free` : '';
  return `${batch}${exp ? ` · exp ${String(exp).slice(0, 10)}` : ''}${avail}`;
}

function parseSerialQuery(raw: string): string[] {
  return raw
    .split(/[\s,;]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

type Props = {
  trackBatch?: boolean;
  trackExpiry?: boolean;
  trackSerial?: boolean;
  /** Required serial count (base units). */
  serialsNeeded?: number;
  lotId: string;
  onLotId: (lotId: string) => void;
  serialNumbers: string[];
  onSerialNumbers: (serials: string[]) => void;
  /** Prefetched options (e.g. from fulfilment task). */
  lots?: LotOption[];
  serials?: SerialOption[];
  /** When set, loads lots/serials from inventory API. */
  productId?: string;
  warehouseId?: string;
  compact?: boolean;
};

/** Optional lot override (FEFO/FIFO if empty) + mandatory serial multi-select when track_serial. */
export const StockIssuePickers: React.FC<Props> = ({
  trackBatch,
  trackExpiry,
  trackSerial,
  serialsNeeded = 0,
  lotId,
  onLotId,
  serialNumbers,
  onSerialNumbers,
  lots: lotsProp,
  serials: serialsProp,
  productId,
  warehouseId,
  compact
}) => {
  const showLot = !!(trackBatch || trackExpiry || trackSerial);
  const [lotsRemote, setLotsRemote] = useState<LotOption[]>([]);
  const [serialsRemote, setSerialsRemote] = useState<SerialOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [serialQuery, setSerialQuery] = useState('');
  const [lookupHint, setLookupHint] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (lotsProp || serialsProp) return;
    if (!productId || !warehouseId || (!showLot && !trackSerial)) return;
    let cancelled = false;
    setLoading(true);
    void (async () => {
      try {
        const [lots, serials] = await Promise.all([
          showLot
            ? api.inventory.lots({ product_id: productId, warehouse_id: warehouseId })
            : Promise.resolve([]),
          trackSerial
            ? api.inventory.serials({ product_id: productId, warehouse_id: warehouseId })
            : Promise.resolve([])
        ]);
        if (cancelled) return;
        setLotsRemote(
          (lots || [])
            .filter((l: any) => Number(l.available || 0) > 0)
            .map((l: any) => ({
              lotId: l.id,
              batchNumber: l.batch_number,
              expiryDate: l.expiry_date,
              available: Number(l.available || 0)
            }))
        );
        setSerialsRemote(
          (serials || []).map((s: any) => ({
            serialNumber: s.serial_number,
            lotId: s.lot_id,
            batchNumber: s.lot?.batch_number,
            expiryDate: s.lot?.expiry_date
          }))
        );
      } catch {
        if (!cancelled) {
          setLotsRemote([]);
          setSerialsRemote([]);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [productId, warehouseId, showLot, trackSerial, lotsProp, serialsProp]);

  const lots = lotsProp || lotsRemote;
  const serials = useMemo(() => {
    const all = serialsProp || serialsRemote;
    if (!lotId) return all;
    return all.filter((s) => (s.lot_id || s.lotId || '') === lotId);
  }, [serialsProp, serialsRemote, lotId]);

  const availableByLower = useMemo(() => {
    const map = new Map<string, string>();
    for (const s of serials) {
      const sn = serialOf(s);
      if (sn) map.set(sn.toLowerCase(), sn);
    }
    return map;
  }, [serials]);

  const filterText = serialQuery.trim().toLowerCase();
  const filteredSerials = useMemo(() => {
    if (!filterText) return serials;
    // Multi-token paste: keep list focused on first incomplete token for browsing
    const token = filterText.split(/[\s,;]+/).filter(Boolean).pop() || filterText;
    return serials.filter((s) => serialOf(s).toLowerCase().includes(token));
  }, [serials, filterText]);

  const toggleSerial = (sn: string) => {
    if (serialNumbers.includes(sn)) {
      onSerialNumbers(serialNumbers.filter((x) => x !== sn));
      return;
    }
    if (serialsNeeded > 0 && serialNumbers.length >= serialsNeeded) return;
    onSerialNumbers([...serialNumbers, sn]);
  };

  /** Add one or more serials typed/pasted/scanned; exact match against available. */
  const addFromQuery = (raw: string) => {
    const tokens = parseSerialQuery(raw);
    if (!tokens.length) return;
    const next = [...serialNumbers];
    const missing: string[] = [];
    const dupes: string[] = [];
    for (const token of tokens) {
      const canonical = availableByLower.get(token.toLowerCase());
      if (!canonical) {
        missing.push(token);
        continue;
      }
      if (next.some((x) => x.toLowerCase() === canonical.toLowerCase())) {
        dupes.push(canonical);
        continue;
      }
      if (serialsNeeded > 0 && next.length >= serialsNeeded) break;
      next.push(canonical);
    }
    if (next.length !== serialNumbers.length) onSerialNumbers(next);
    setSerialQuery('');
    if (missing.length) {
      setLookupHint(`Not available: ${missing.slice(0, 5).join(', ')}${missing.length > 5 ? '…' : ''}`);
    } else if (serialsNeeded > 0 && next.length >= serialsNeeded) {
      setLookupHint(`Selected ${next.length}/${serialsNeeded}`);
    } else if (dupes.length && next.length === serialNumbers.length) {
      setLookupHint('Already selected');
    } else {
      setLookupHint(null);
    }
    searchRef.current?.focus();
  };

  if (!showLot && !trackSerial) return null;

  return (
    <div style={{ display: 'grid', gap: compact ? 6 : 8, marginTop: compact ? 4 : 8 }}>
      {showLot ? (
        <div className="field" style={{ margin: 0 }}>
          <label style={{ fontSize: '0.8rem' }}>
            Lot / batch {trackSerial ? '' : '(optional — FEFO/FIFO if blank)'}
          </label>
          <select
            value={lotId}
            onChange={(e) => {
              onLotId(e.target.value);
              onSerialNumbers([]);
              setSerialQuery('');
              setLookupHint(null);
            }}
          >
            <option value="">{loading ? 'Loading…' : 'Auto (FEFO / FIFO)'}</option>
            {lots.map((l) => {
              const id = lotIdOf(l);
              return (
                <option key={id} value={id}>
                  {lotLabel(l)}
                </option>
              );
            })}
          </select>
        </div>
      ) : null}

      {trackSerial ? (
        <div className="field" style={{ margin: 0 }}>
          <label style={{ fontSize: '0.8rem' }}>
            Serial numbers
            {serialsNeeded > 0
              ? ` — select ${serialsNeeded} (${serialNumbers.length}/${serialsNeeded})`
              : ` — ${serialNumbers.length} selected`}
          </label>

          {serialNumbers.length ? (
            <div
              style={{
                display: 'flex',
                flexWrap: 'wrap',
                gap: 4,
                marginBottom: 6
              }}
            >
              {serialNumbers.map((sn) => (
                <button
                  key={sn}
                  type="button"
                  className="btn btn-ghost"
                  style={{
                    padding: '0.15rem 0.45rem',
                    fontSize: '0.75rem',
                    fontFamily: 'ui-monospace, monospace',
                    border: '1px solid var(--border, #ddd)',
                    borderRadius: 4
                  }}
                  title="Remove"
                  onClick={() => toggleSerial(sn)}
                >
                  {sn} ×
                </button>
              ))}
            </div>
          ) : null}

          {loading ? (
            <div style={{ color: 'var(--ink-muted)', fontSize: '0.8rem' }}>Loading serials…</div>
          ) : !serials.length ? (
            <div style={{ color: 'var(--accent)', fontSize: '0.8rem' }}>
              No available serials{lotId ? ' on this lot' : ' in this warehouse'}
              {(lotsProp || lotsRemote).some((l) => Number(l.available || 0) > 0)
                ? ' — lot qty exists but serial units are missing (receive/restock with serials).'
                : '.'}
            </div>
          ) : (
            <>
              <div style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
                <input
                  ref={searchRef}
                  type="search"
                  value={serialQuery}
                  placeholder="Find or scan serial — Enter to add"
                  style={{ flex: 1, fontFamily: 'ui-monospace, monospace', fontSize: '0.85rem' }}
                  disabled={serialsNeeded > 0 && serialNumbers.length >= serialsNeeded}
                  onChange={(e) => {
                    setSerialQuery(e.target.value);
                    setLookupHint(null);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      e.stopPropagation();
                      addFromQuery(serialQuery);
                    }
                  }}
                  onPaste={(e) => {
                    const text = e.clipboardData.getData('text');
                    if (/[\s,;]/.test(text)) {
                      e.preventDefault();
                      addFromQuery(text);
                    }
                  }}
                />
                <button
                  type="button"
                  className="btn btn-ghost"
                  disabled={!serialQuery.trim()}
                  onClick={() => addFromQuery(serialQuery)}
                >
                  Add
                </button>
              </div>
              {lookupHint ? (
                <div style={{ color: 'var(--accent)', fontSize: '0.75rem', marginBottom: 4 }}>
                  {lookupHint}
                </div>
              ) : (
                <div style={{ color: 'var(--ink-muted)', fontSize: '0.75rem', marginBottom: 4 }}>
                  Type to filter · Enter / Add to pick · paste several at once
                  {filterText
                    ? ` · showing ${filteredSerials.length} of ${serials.length}`
                    : ` · ${serials.length} available`}
                </div>
              )}
              <div
                style={{
                  maxHeight: compact ? 120 : 160,
                  overflow: 'auto',
                  border: '1px solid var(--border, #ddd)',
                  borderRadius: 6,
                  padding: '0.35rem 0.5rem',
                  display: 'grid',
                  gap: 2
                }}
              >
                {filteredSerials.length ? (
                  filteredSerials.map((s) => {
                    const sn = serialOf(s);
                    const checked = serialNumbers.includes(sn);
                    const disabled =
                      !checked && serialsNeeded > 0 && serialNumbers.length >= serialsNeeded;
                    return (
                      <label
                        key={sn}
                        style={{
                          display: 'flex',
                          gap: 8,
                          alignItems: 'center',
                          fontSize: '0.85rem',
                          opacity: disabled ? 0.45 : 1,
                          cursor: disabled ? 'not-allowed' : 'pointer'
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          disabled={disabled}
                          onChange={() => toggleSerial(sn)}
                        />
                        <span style={{ fontFamily: 'ui-monospace, monospace' }}>{sn}</span>
                        {!lotId && (s.batch_number || s.batchNumber) ? (
                          <span style={{ color: 'var(--ink-muted)', fontSize: '0.75rem' }}>
                            {s.batch_number || s.batchNumber}
                            {s.expiry_date || s.expiryDate
                              ? ` · ${String(s.expiry_date || s.expiryDate).slice(0, 10)}`
                              : ''}
                          </span>
                        ) : null}
                      </label>
                    );
                  })
                ) : (
                  <div style={{ color: 'var(--ink-muted)', fontSize: '0.8rem' }}>
                    No serials match “{serialQuery.trim()}”. Press Enter if you typed a full serial.
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      ) : null}
    </div>
  );
};
