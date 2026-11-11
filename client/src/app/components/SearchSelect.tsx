import React, { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, X } from 'lucide-react';

export type SearchSelectOption = {
  value: string;
  label: string;
};

type Props = {
  value: string;
  options: SearchSelectOption[];
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  required?: boolean;
  allowEmpty?: boolean;
  emptyLabel?: string;
  id?: string;
};

export const SearchSelect: React.FC<Props> = ({
  value,
  options,
  onChange,
  placeholder = 'Type to search…',
  disabled = false,
  required = false,
  allowEmpty = false,
  emptyLabel = '—',
  id
}) => {
  const listId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const [open, setOpen] = useState(false);
  const [menuRect, setMenuRect] = useState<{ top: number; left: number; width: number } | null>(
    null
  );
  const [query, setQuery] = useState('');
  const [highlight, setHighlight] = useState(0);

  const selected = useMemo(
    () => options.find((o) => o.value === value) || null,
    [options, value]
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const base = !q
      ? options
      : options.filter((o) => o.label.toLowerCase().includes(q));
    if (allowEmpty && !q) {
      return [{ value: '', label: emptyLabel }, ...base];
    }
    if (allowEmpty && q && emptyLabel.toLowerCase().includes(q)) {
      return [{ value: '', label: emptyLabel }, ...base];
    }
    return base;
  }, [options, query, allowEmpty, emptyLabel]);

  useEffect(() => {
    if (!open) {
      setQuery('');
      setHighlight(0);
    }
  }, [open]);

  useEffect(() => {
    setHighlight(0);
  }, [query]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      const target = e.target as Node;
      if (rootRef.current?.contains(target) || listRef.current?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  useLayoutEffect(() => {
    if (!open) return;
    const update = () => {
      const r = rootRef.current?.getBoundingClientRect();
      if (r) setMenuRect({ top: r.bottom + 4, left: r.left, width: r.width });
    };
    update();
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
    };
  }, [open]);

  const pick = (next: string) => {
    onChange(next);
    setOpen(false);
    setQuery('');
  };

  const displayValue = open ? query : selected?.label || (value === '' && allowEmpty ? emptyLabel : '');

  return (
    <div ref={rootRef} className="search-select" style={{ position: 'relative', width: '100%' }}>
      <input type="hidden" value={value} required={required && !disabled} readOnly />
      <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
        <input
          ref={inputRef}
          id={id}
          className="search-select__input"
          type="text"
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          disabled={disabled}
          placeholder={selected ? undefined : placeholder}
          value={displayValue}
          onChange={(e) => {
            setQuery(e.target.value);
            if (!open) setOpen(true);
          }}
          onFocus={() => {
            if (!disabled) setOpen(true);
          }}
          onClick={() => {
            if (!disabled) setOpen(true);
          }}
          onKeyDown={(e) => {
            if (disabled) return;
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setOpen(true);
              setHighlight((h) => Math.min(h + 1, Math.max(filtered.length - 1, 0)));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setHighlight((h) => Math.max(h - 1, 0));
            } else if (e.key === 'Enter') {
              if (open && filtered[highlight]) {
                e.preventDefault();
                pick(filtered[highlight].value);
              }
            } else if (e.key === 'Escape') {
              setOpen(false);
              setQuery('');
            }
          }}
          style={{ paddingRight: value && !disabled ? '2.4rem' : '2.1rem' }}
        />
        {value && !disabled && allowEmpty ? (
          <button
            type="button"
            aria-label="Clear selection"
            onClick={() => {
              pick('');
              inputRef.current?.focus();
            }}
            style={{
              position: 'absolute',
              right: '1.7rem',
              border: 'none',
              background: 'transparent',
              padding: 0,
              display: 'inline-flex',
              color: 'var(--ink-muted)',
              cursor: 'pointer'
            }}
          >
            <X size={14} />
          </button>
        ) : null}
        <span
          aria-hidden
          style={{
            position: 'absolute',
            right: '0.7rem',
            display: 'inline-flex',
            color: 'var(--ink-muted)',
            pointerEvents: 'none'
          }}
        >
          <ChevronDown size={15} />
        </span>
      </div>

      {open && !disabled && menuRect ? createPortal(
        <ul
          ref={listRef}
          id={listId}
          role="listbox"
          style={{
            position: 'fixed',
            zIndex: 1000,
            top: menuRect.top,
            left: menuRect.left,
            width: menuRect.width,
            margin: 0,
            padding: '0.35rem',
            listStyle: 'none',
            maxHeight: 220,
            overflowY: 'auto',
            background: 'white',
            border: '1px solid var(--line)',
            borderRadius: 10,
            boxShadow: '0 10px 28px rgba(15, 23, 42, 0.12)'
          }}
        >
          {filtered.length === 0 ? (
            <li
              style={{
                padding: '0.55rem 0.7rem',
                color: 'var(--ink-muted)',
                fontSize: '0.9rem'
              }}
            >
              No matches
            </li>
          ) : (
            filtered.map((o, i) => {
              const active = o.value === value;
              const hi = i === highlight;
              return (
                <li
                  key={`${o.value || 'empty'}-${o.label}`}
                  role="option"
                  aria-selected={active}
                  onMouseEnter={() => setHighlight(i)}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    pick(o.value);
                  }}
                  style={{
                    padding: '0.55rem 0.7rem',
                    borderRadius: 8,
                    cursor: 'pointer',
                    background: hi ? 'rgba(15, 92, 76, 0.1)' : 'transparent',
                    fontWeight: active ? 600 : 400
                  }}
                >
                  {o.label}
                </li>
              );
            })
          )}
        </ul>,
        document.body
      ) : null}
    </div>
  );
};
