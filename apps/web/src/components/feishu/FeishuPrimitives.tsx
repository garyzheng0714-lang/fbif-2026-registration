import { useEffect, useRef } from 'react';
import type {
  ButtonHTMLAttributes,
  HTMLAttributes,
  InputHTMLAttributes,
  MouseEventHandler,
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

type FeishuSelectProps = SelectHTMLAttributes<HTMLSelectElement> & {
  status?: FeishuControlStatus;
};

export function FeishuSelect({ status = 'default', className, children, ...rest }: FeishuSelectProps) {
  return (
    <select className={cx('fs-select', status === 'error' && 'is-error', className)} {...rest}>
      {children}
    </select>
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
