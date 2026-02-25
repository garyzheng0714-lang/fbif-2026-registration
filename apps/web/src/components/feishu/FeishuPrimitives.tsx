import {
  Children,
  isValidElement,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState
} from 'react';
import type {
  ButtonHTMLAttributes,
  ChangeEvent,
  FocusEvent as ReactFocusEvent,
  HTMLAttributes,
  InputHTMLAttributes,
  MouseEventHandler,
  KeyboardEvent as ReactKeyboardEvent,
  ReactNode,
  SelectHTMLAttributes
} from 'react';

type ClassValue = string | false | null | undefined;

function cx(...classValues: ClassValue[]) {
  return classValues.filter(Boolean).join(' ');
}

type FeishuCardProps = HTMLAttributes<HTMLElement> & {
  as?: 'section' | 'div' | 'article';
};

export function FeishuCard({ as = 'section', className, ...rest }: FeishuCardProps) {
  const Comp = as;
  return <Comp className={cx('card', 'fs-card', className)} {...rest} />;
}

type FeishuButtonVariant = 'primary' | 'secondary' | 'text' | 'danger';
type FeishuButtonSize = 'sm' | 'md' | 'lg';

type FeishuButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: FeishuButtonVariant;
  size?: FeishuButtonSize;
  block?: boolean;
  loading?: boolean;
  icon?: ReactNode;
};

export function FeishuButton({
  variant = 'primary',
  size = 'md',
  block = false,
  loading = false,
  icon,
  className,
  children,
  disabled,
  ...rest
}: FeishuButtonProps) {
  return (
    <button
      {...rest}
      disabled={disabled || loading}
      className={cx(
        'fs-button',
        `fs-button-${variant}`,
        `fs-button-${size}`,
        block && 'fs-button-block',
        loading && 'is-loading',
        className
      )}
      aria-busy={loading || undefined}
    >
      {icon ? <span className="fs-button-icon" aria-hidden="true">{icon}</span> : null}
      <span className="fs-button-label">{children}</span>
    </button>
  );
}

type FeishuControlStatus = 'default' | 'error';

type FeishuInputProps = InputHTMLAttributes<HTMLInputElement> & {
  status?: FeishuControlStatus;
};

export function FeishuInput({ status = 'default', className, ...rest }: FeishuInputProps) {
  return <input className={cx('fs-input', status === 'error' && 'is-error', className)} {...rest} />;
}

type FeishuSelectProps = Omit<SelectHTMLAttributes<HTMLSelectElement>, 'multiple' | 'size'> & {
  status?: FeishuControlStatus;
};

type ParsedSelectOption = {
  value: string;
  label: ReactNode;
  disabled: boolean;
};

function parseSelectChildren(children: ReactNode): ParsedSelectOption[] {
  return Children.toArray(children)
    .map((child): ParsedSelectOption | null => {
      if (!isValidElement(child) || child.type !== 'option') {
        return null;
      }

      const value = String(child.props.value ?? '');
      const label = child.props.children;
      return {
        value,
        label,
        disabled: Boolean(child.props.disabled)
      };
    })
    .filter((item): item is ParsedSelectOption => Boolean(item));
}

function findEnabledIndex(
  options: ParsedSelectOption[],
  startIndex: number,
  step: 1 | -1
) {
  if (options.length === 0) return -1;
  let idx = startIndex;
  for (let i = 0; i < options.length; i += 1) {
    idx = (idx + step + options.length) % options.length;
    if (!options[idx]?.disabled) return idx;
  }
  return -1;
}

function firstEnabledIndex(options: ParsedSelectOption[]) {
  return options.findIndex((option) => !option.disabled);
}

export function FeishuSelect({
  status = 'default',
  className,
  children,
  value,
  onChange,
  onBlur,
  onFocus,
  disabled,
  id,
  name,
  required,
  'aria-label': ariaLabel,
  ...rest
}: FeishuSelectProps) {
  const generatedId = useId();
  const controlId = id || `fs-select-${generatedId}`;
  const listboxId = `${controlId}-listbox`;
  const rootRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const listboxRef = useRef<HTMLDivElement | null>(null);
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [popoverPlacement, setPopoverPlacement] = useState<'bottom' | 'top'>('bottom');
  const [popoverMaxHeight, setPopoverMaxHeight] = useState<number>(240);

  const options = useMemo(() => parseSelectChildren(children), [children]);
  const currentValue = String(value ?? '');
  const selectedIndex = options.findIndex((option) => option.value === currentValue);
  const selectedOption = selectedIndex >= 0 ? options[selectedIndex] : null;
  const displayLabel = selectedOption?.label ?? options[0]?.label ?? '请选择';
  const isPlaceholder = !selectedOption || currentValue === '';

  useEffect(() => {
    if (!open) return;

    const onPointerDown = (event: MouseEvent | TouchEvent) => {
      const target = event.target as Node | null;
      if (target && rootRef.current?.contains(target)) return;
      setOpen(false);
    };

    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('touchstart', onPointerDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('touchstart', onPointerDown);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const nextIndex = selectedIndex >= 0 && !options[selectedIndex]?.disabled
      ? selectedIndex
      : firstEnabledIndex(options);
    setActiveIndex(nextIndex);
  }, [open, selectedIndex, options]);

  useEffect(() => {
    if (!open || activeIndex < 0) return;
    const activeNode = optionRefs.current[activeIndex];
    if (activeNode && typeof activeNode.scrollIntoView === 'function') {
      activeNode.scrollIntoView({ block: 'nearest' });
    }
  }, [open, activeIndex]);

  useEffect(() => {
    if (!open) return;

    const updatePopoverViewportFit = () => {
      const trigger = triggerRef.current;
      if (!trigger) return;

      const rect = trigger.getBoundingClientRect();
      const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 0;
      const gap = 6;
      const edgePadding = 8;

      let bottomLimit = viewportHeight - edgePadding;
      const submitDock = document.querySelector('.submit-dock');
      if (submitDock instanceof HTMLElement) {
        const dockRect = submitDock.getBoundingClientRect();
        if (dockRect.top > 0 && dockRect.top < viewportHeight) {
          bottomLimit = Math.min(bottomLimit, dockRect.top - edgePadding);
        }
      }

      const topLimit = edgePadding;
      const spaceBelow = Math.max(0, bottomLimit - (rect.bottom + gap));
      const spaceAbove = Math.max(0, (rect.top - gap) - topLimit);
      const naturalHeight = Math.max(160, Math.min(320, listboxRef.current?.scrollHeight || 240));
      const preferTop = spaceBelow < Math.min(220, naturalHeight) && spaceAbove > spaceBelow;
      const available = preferTop ? spaceAbove : spaceBelow;
      const fallbackAvailable = Math.max(spaceAbove, spaceBelow);
      const fittedMaxHeight = Math.max(120, Math.min(320, available || fallbackAvailable || 240));

      setPopoverPlacement(preferTop ? 'top' : 'bottom');
      setPopoverMaxHeight(fittedMaxHeight);
    };

    updatePopoverViewportFit();

    const handleViewportChange = () => updatePopoverViewportFit();
    window.addEventListener('resize', handleViewportChange);
    window.addEventListener('scroll', handleViewportChange, true);
    return () => {
      window.removeEventListener('resize', handleViewportChange);
      window.removeEventListener('scroll', handleViewportChange, true);
    };
  }, [open, options.length]);

  const emitChange = (nextValue: string) => {
    if (nextValue === currentValue) return;
    const syntheticEvent = {
      target: { value: nextValue, name },
      currentTarget: { value: nextValue, name }
    } as unknown as ChangeEvent<HTMLSelectElement>;
    onChange?.(syntheticEvent);
  };

  const closeAndFocusTrigger = () => {
    setOpen(false);
    triggerRef.current?.focus();
  };

  const selectByIndex = (index: number) => {
    const option = options[index];
    if (!option || option.disabled) return;
    emitChange(option.value);
    closeAndFocusTrigger();
  };

  const openMenu = () => {
    if (disabled) return;
    setOpen(true);
  };

  const handleTriggerKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (disabled) return;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (!open) {
        openMenu();
        return;
      }
      setActiveIndex((prev) => {
        const start = prev >= 0 ? prev : (selectedIndex >= 0 ? selectedIndex : -1);
        return findEnabledIndex(options, start, event.key === 'ArrowDown' ? 1 : -1);
      });
      return;
    }

    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      setOpen((prev) => !prev);
      return;
    }

    if (event.key === 'Home') {
      event.preventDefault();
      setActiveIndex(firstEnabledIndex(options));
      if (!open) openMenu();
      return;
    }

    if (event.key === 'End') {
      event.preventDefault();
      const reversed = [...options].reverse();
      const idxFromEnd = reversed.findIndex((option) => !option.disabled);
      const lastIndex = idxFromEnd < 0 ? -1 : options.length - 1 - idxFromEnd;
      setActiveIndex(lastIndex);
      if (!open) openMenu();
    }
  };

  const handleListKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (!open) return;

    if (event.key === 'Escape') {
      event.preventDefault();
      closeAndFocusTrigger();
      return;
    }

    if (event.key === 'Tab') {
      setOpen(false);
      return;
    }

    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveIndex((prev) => {
        const start = prev >= 0 ? prev : (selectedIndex >= 0 ? selectedIndex : -1);
        return findEnabledIndex(options, start, event.key === 'ArrowDown' ? 1 : -1);
      });
      return;
    }

    if (event.key === 'Home') {
      event.preventDefault();
      setActiveIndex(firstEnabledIndex(options));
      return;
    }

    if (event.key === 'End') {
      event.preventDefault();
      const reversed = [...options].reverse();
      const idxFromEnd = reversed.findIndex((option) => !option.disabled);
      setActiveIndex(idxFromEnd < 0 ? -1 : options.length - 1 - idxFromEnd);
      return;
    }

    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      if (activeIndex >= 0) selectByIndex(activeIndex);
    }
  };

  return (
    <div
      ref={rootRef}
      className={cx(
        'fs-select',
        status === 'error' && 'is-error',
        open && 'is-open',
        disabled && 'is-disabled',
        className
      )}
      onBlur={(event) => {
        const next = event.relatedTarget as Node | null;
        if (next && rootRef.current?.contains(next)) return;
        setOpen(false);
        onBlur?.(event as unknown as ReactFocusEvent<HTMLSelectElement>);
      }}
    >
      <button
        {...rest}
        ref={triggerRef}
        id={controlId}
        type="button"
        name={name}
        disabled={disabled}
        className="fs-select-trigger"
        aria-label={ariaLabel}
        aria-invalid={status === 'error' || undefined}
        aria-required={required || undefined}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listboxId}
        onFocus={(event) => onFocus?.(event as unknown as ReactFocusEvent<HTMLSelectElement>)}
        onKeyDown={handleTriggerKeyDown}
        onClick={() => {
          if (disabled) return;
          setOpen((prev) => !prev);
        }}
      >
        <span className={cx('fs-select-value', isPlaceholder && 'is-placeholder')}>
          {displayLabel}
        </span>
        <span className="fs-select-arrow" aria-hidden="true">
          <svg viewBox="0 0 16 16" fill="none">
            <path d="m4 6 4 4 4-4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
      </button>

      {open && (
        <div
          ref={listboxRef}
          id={listboxId}
          role="listbox"
          aria-labelledby={controlId}
          className={cx('fs-select-popover', popoverPlacement === 'top' && 'is-top')}
          style={{ maxHeight: popoverMaxHeight }}
          tabIndex={-1}
          onKeyDown={handleListKeyDown}
        >
          {options.map((option, index) => {
            const selected = option.value === currentValue;
            const active = index === activeIndex;
            return (
              <button
                key={`${option.value}-${index}`}
                ref={(node) => {
                  optionRefs.current[index] = node;
                }}
                type="button"
                role="option"
                aria-selected={selected}
                disabled={option.disabled}
                className={cx(
                  'fs-select-option',
                  selected && 'is-selected',
                  active && 'is-active'
                )}
                onMouseEnter={() => {
                  if (!option.disabled) {
                    setActiveIndex(index);
                  }
                }}
                onMouseDown={(event) => {
                  // Keep focus inside the trigger/listbox combo until selection is applied.
                  event.preventDefault();
                }}
                onClick={() => selectByIndex(index)}
              >
                <span className="fs-select-option-label">{option.label}</span>
                {selected ? <span className="fs-select-option-check" aria-hidden="true">✓</span> : null}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

type FeishuFieldProps = {
  label: ReactNode;
  htmlFor?: string;
  required?: boolean;
  error?: string;
  hint?: ReactNode;
  children: ReactNode;
  className?: string;
};

export function FeishuField({
  label,
  htmlFor,
  required = false,
  error = '',
  hint,
  children,
  className
}: FeishuFieldProps) {
  return (
    <div className={cx('field', 'fs-field', className)}>
      <label htmlFor={htmlFor} className={cx('fs-field-label', required && 'is-required')}>
        <span>{label}</span>
      </label>
      {children}
      {hint ? <p className="fs-field-hint">{hint}</p> : null}
      {error ? <span className="error">{error}</span> : null}
    </div>
  );
}

type FeishuLoadingProps = {
  size?: 'sm' | 'md';
  text?: string;
  className?: string;
};

export function FeishuLoading({ size = 'sm', text, className }: FeishuLoadingProps) {
  return (
    <span className={cx('fs-loading', `fs-loading-${size}`, className)} aria-live="polite">
      <span className="spinner" aria-hidden="true" />
      {text ? <span className="fs-loading-text">{text}</span> : null}
    </span>
  );
}

type FeishuDialogProps = {
  open: boolean;
  title: ReactNode;
  body?: ReactNode;
  footer?: ReactNode;
  ariaLabel?: string;
  onClose?: () => void;
  closeOnMask?: boolean;
  closeOnEsc?: boolean;
  className?: string;
};

const focusableSelector =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function FeishuDialog({
  open,
  title,
  body,
  footer,
  ariaLabel,
  onClose,
  closeOnMask = false,
  closeOnEsc = true,
  className
}: FeishuDialogProps) {
  const dialogRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;

    const previousActive = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const dialogNode = dialogRef.current;
    if (!dialogNode) return;

    const focusables = Array.from(dialogNode.querySelectorAll<HTMLElement>(focusableSelector));
    const first = focusables[0] ?? dialogNode;
    first.focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && closeOnEsc) {
        event.preventDefault();
        onClose?.();
        return;
      }
      if (event.key !== 'Tab') return;

      const nodes = Array.from(dialogNode.querySelectorAll<HTMLElement>(focusableSelector));
      if (nodes.length === 0) {
        event.preventDefault();
        dialogNode.focus();
        return;
      }

      const firstNode = nodes[0];
      const lastNode = nodes[nodes.length - 1];
      const current = document.activeElement as HTMLElement | null;

      if (event.shiftKey && current === firstNode) {
        event.preventDefault();
        lastNode.focus();
      } else if (!event.shiftKey && current === lastNode) {
        event.preventDefault();
        firstNode.focus();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      previousActive?.focus();
    };
  }, [open, onClose, closeOnEsc]);

  if (!open) return null;

  const onOverlayClick: MouseEventHandler<HTMLDivElement> = (event) => {
    if (!closeOnMask) return;
    if (event.target !== event.currentTarget) return;
    onClose?.();
  };

  return (
    <div
      className="modal-overlay"
      role="presentation"
      onClick={onOverlayClick}
    >
      <div
        ref={dialogRef}
        className={cx('modal', 'fs-dialog', className)}
        role="dialog"
        aria-modal="true"
        aria-label={ariaLabel}
        tabIndex={-1}
      >
        <h3 className="modal-title">{title}</h3>
        {body ? <div className="modal-body">{body}</div> : null}
        {footer ? <div className="modal-actions">{footer}</div> : null}
      </div>
    </div>
  );
}
