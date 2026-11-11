import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown } from 'lucide-react';

export type MultiSelectOption = {
  value: string;
  label: string;
  /** Optional group heading (e.g. branch name for warehouses). */
  group?: string;
  muted?: boolean;
};

type Props = {
  /** Empty array means "All". */
  value: string[];
  options: MultiSelectOption[];
  onChange: (value: string[]) => void;
  allLabel?: string;
  noun?: string;
  disabled?: boolean;
};

export const MultiSelect: React.FC<Props> = ({
  value,
  options,
  onChange,
  allLabel = 'All',
  noun = 'items',
  disabled = false
}) => {
  const rootRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [rect, setRect] = useState<{ top: number; left: number; width: number } | null>(null);

  const selected = useMemo(() => new Set(value), [value]);
  const allSelected = value.length === 0;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q
      ? options.filter(
          (o) => o.label.toLowerCase().includes(q) || (o.group || '').toLowerCase().includes(q)
        )
      : options;
  }, [options, query]);

  useEffect(() => {
    if (!open) {
      setQuery('');
      return;
    }
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      if (rootRef.current?.contains(t) || menuRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  useLayoutEffect(() => {
    if (!open) return;
    const update = () => {
      const r = rootRef.current?.getBoundingClientRect();
      if (r) setRect({ top: r.bottom + 4, left: r.left, width: Math.max(r.width, 260) });
    };
    update();
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
    };
  }, [open]);

  const toggle = (v: string) => {
    const next = new Set(selected);
    if (next.has(v)) next.delete(v);
    else next.add(v);
    // Every option ticked is the same as "All".
    onChange(next.size === options.length ? [] : [...next]);
  };

  const summary = allSelected
    ? allLabel
    : value.length === 1
      ? options.find((o) => o.value === value[0])?.label || `1 ${noun}`
      : `${value.length} ${noun} selected`;

  let lastGroup: string | undefined;

  return (
    <>
      <button
        ref={rootRef}
        type="button"
        className="multi-select__trigger"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <span className={allSelected ? 'multi-select__all' : undefined}>{summary}</span>
        <ChevronDown size={15} />
      </button>
      {open && rect
        ? createPortal(
            <div
              ref={menuRef}
              className="multi-select__menu"
              style={{ top: rect.top, left: rect.left, width: rect.width }}
            >
              {options.length > 6 ? (
                <input
                  autoFocus
                  className="multi-select__search"
                  placeholder="Search…"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
              ) : null}
              <button
                type="button"
                className={`multi-select__option multi-select__option--all${allSelected ? ' is-on' : ''}`}
                onClick={() => onChange([])}
              >
                <span className="multi-select__box">{allSelected ? <Check size={12} /> : null}</span>
                {allLabel}
              </button>
              <div className="multi-select__list" role="listbox" aria-multiselectable>
                {filtered.map((o) => {
                  const on = !allSelected && selected.has(o.value);
                  const heading = o.group && o.group !== lastGroup ? o.group : null;
                  lastGroup = o.group;
                  return (
                    <React.Fragment key={o.value}>
                      {heading ? <div className="multi-select__group">{heading}</div> : null}
                      <button
                        type="button"
                        role="option"
                        aria-selected={on}
                        className={`multi-select__option${on ? ' is-on' : ''}${o.muted ? ' is-muted' : ''}`}
                        onClick={() => toggle(o.value)}
                      >
                        <span className="multi-select__box">{on ? <Check size={12} /> : null}</span>
                        {o.label}
                      </button>
                    </React.Fragment>
                  );
                })}
                {!filtered.length ? <div className="multi-select__empty">No matches</div> : null}
              </div>
            </div>,
            document.body
          )
        : null}
    </>
  );
};
