'use client';

import * as React from 'react';
import { Loader2, Search } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface ComboboxOption {
  value: string;
  label: string;
  description?: string;
}

interface ComboboxProps {
  id: string;
  /** Accessible name (visible <Label htmlFor={id}> recommended as well). */
  'aria-label'?: string;
  inputValue: string;
  onInputChange: (value: string) => void;
  options: ComboboxOption[];
  onSelect: (option: ComboboxOption) => void;
  placeholder?: string;
  loading?: boolean;
  /** Shown in the popup when there are no options (e.g. "no results", "type more"). */
  statusMessage?: string;
  /** Value currently chosen, marked with aria-selected. */
  selectedValue?: string;
  autoFocus?: boolean;
  onFocus?: () => void;
  onBlur?: () => void;
  onEscape?: () => void;
  className?: string;
}

/**
 * Pill search input + listbox, following the WAI-ARIA combobox pattern
 * (aria-activedescendant, ↑/↓/Enter/Escape). Filtering is the caller's job so
 * it works for remote (city search) and local (timezones) data alike.
 */
export function Combobox({
  id,
  'aria-label': ariaLabel,
  inputValue,
  onInputChange,
  options,
  onSelect,
  placeholder,
  loading = false,
  statusMessage,
  selectedValue,
  autoFocus,
  onFocus,
  onBlur,
  onEscape,
  className,
}: ComboboxProps) {
  const [open, setOpen] = React.useState(false);
  const [active, setActive] = React.useState(0);
  const listRef = React.useRef<HTMLUListElement>(null);
  const listId = `${id}-listbox`;

  React.useEffect(() => {
    setActive(0);
  }, [options]);

  React.useEffect(() => {
    if (!open) return;
    const el = listRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`);
    el?.scrollIntoView?.({ block: 'nearest' });
  }, [active, open]);

  const choose = (option: ComboboxOption) => {
    onSelect(option);
    setOpen(false);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setOpen(true);
      setActive((i) => (options.length ? (i + 1) % options.length : 0));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setOpen(true);
      setActive((i) => (options.length ? (i - 1 + options.length) % options.length : 0));
    } else if (e.key === 'Enter') {
      if (open && options[active]) {
        e.preventDefault();
        choose(options[active]);
      }
    } else if (e.key === 'Escape') {
      if (open) {
        e.preventDefault();
        setOpen(false);
      } else {
        onEscape?.();
      }
    }
  };

  const showPopup = open && (options.length > 0 || !!statusMessage || loading);
  const activeId = showPopup && options[active] ? `${id}-option-${active}` : undefined;

  return (
    <div className={cn('relative', className)}>
      <Search
        className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
        strokeWidth={1.75}
        aria-hidden
      />
      <input
        id={id}
        type="text"
        role="combobox"
        autoComplete="off"
        spellCheck={false}
        aria-label={ariaLabel}
        aria-autocomplete="list"
        aria-expanded={showPopup}
        aria-controls={listId}
        aria-activedescendant={activeId}
        autoFocus={autoFocus}
        value={inputValue}
        placeholder={placeholder}
        onChange={(e) => {
          onInputChange(e.target.value);
          setOpen(true);
        }}
        onFocus={() => {
          setOpen(true);
          onFocus?.();
        }}
        onBlur={() => {
          // Let option clicks (mousedown) land before closing.
          setOpen(false);
          onBlur?.();
        }}
        onKeyDown={onKeyDown}
        className={cn(
          'flex h-12 w-full rounded-full border-[1.5px] border-input bg-background py-2 pl-11 pr-11 text-[15px] text-foreground',
          'placeholder:text-muted-foreground transition-[border-color,box-shadow] duration-150',
          'focus-visible:outline-none focus-visible:border-foreground focus-visible:ring-4 focus-visible:ring-signature/40'
        )}
      />
      {loading && (
        <Loader2
          className="absolute right-4 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-muted-foreground"
          aria-hidden
        />
      )}
      <ul
        ref={listRef}
        id={listId}
        role="listbox"
        aria-label={ariaLabel}
        hidden={!showPopup}
        className="absolute left-0 right-0 top-[calc(100%+6px)] z-50 max-h-72 overflow-auto rounded-[20px] border border-border bg-card p-1.5 shadow-lg"
      >
        {options.map((option, index) => {
          const isActive = index === active;
          const isSelected = option.value === selectedValue;
          return (
            <li
              key={option.value}
              id={`${id}-option-${index}`}
              data-index={index}
              role="option"
              aria-selected={isSelected}
              onMouseDown={(e) => {
                e.preventDefault();
                choose(option);
              }}
              onMouseEnter={() => setActive(index)}
              className={cn(
                'flex min-h-[44px] cursor-pointer flex-col justify-center rounded-[14px] px-3 py-2 text-[15px]',
                isActive ? 'bg-panel' : 'bg-transparent',
                isSelected && 'font-bold'
              )}
            >
              <span className="leading-tight">{option.label}</span>
              {option.description && (
                <span className="text-[13px] leading-tight text-muted-foreground">
                  {option.description}
                </span>
              )}
            </li>
          );
        })}
        {options.length === 0 && statusMessage && (
          <li role="presentation" className="px-3 py-2.5 text-sm text-muted-foreground">
            {statusMessage}
          </li>
        )}
      </ul>
    </div>
  );
}
