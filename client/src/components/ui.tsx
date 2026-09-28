import React, { useEffect, useLayoutEffect, useRef, useState, useCallback, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { FileText, Database as DbIcon } from 'lucide-react';
import { useApp } from '../store';
import type { User } from '../types';

// ---------------------------------------------------------------------------
// Popover — portal-rendered floating layer anchored to an element or rect.
// Maintains a global stack so nested popovers behave like Notion's menus.
// ---------------------------------------------------------------------------

type Anchor = HTMLElement | DOMRect | { x: number; y: number; width?: number; height?: number } | null;
const stack: { el: HTMLElement | null; id: number }[] = [];
let popSeq = 0;

function rectOf(anchor: Anchor): { left: number; top: number; width: number; height: number } {
  if (!anchor) return { left: 0, top: 0, width: 0, height: 0 };
  if (anchor instanceof HTMLElement) {
    const r = anchor.getBoundingClientRect();
    return { left: r.left, top: r.top, width: r.width, height: r.height };
  }
  if ('left' in anchor) return { left: anchor.left, top: anchor.top, width: anchor.width, height: anchor.height };
  return { left: anchor.x, top: anchor.y, width: anchor.width || 0, height: anchor.height || 0 };
}

export interface PopoverProps {
  anchor: Anchor;
  onClose: () => void;
  children: ReactNode;
  placement?: 'bottom-start' | 'bottom-end' | 'top-start' | 'right-start' | 'left-start' | 'bottom-center' | 'bottom';
  offset?: number;
  width?: number;
  className?: string;
  style?: React.CSSProperties;
  closeOnEsc?: boolean;
  autoFocus?: boolean;
}

export function Popover({ anchor, onClose, children, placement = 'bottom-start', offset = 4, width, className = '', style, closeOnEsc = true }: PopoverProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number; maxHeight?: number } | null>(null);
  const idRef = useRef(++popSeq);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  const place = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const a = rectOf(anchor);
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let left = a.left;
    let top = a.top + a.height + offset;
    if (placement === 'bottom-end') left = a.left + a.width - w;
    if (placement === 'bottom-center' || placement === 'bottom') left = a.left + a.width / 2 - w / 2;
    if (placement === 'top-start') top = a.top - h - offset;
    if (placement === 'right-start') {
      left = a.left + a.width + offset;
      top = a.top;
      if (left + w > vw - 8) left = a.left - w - offset;
    }
    if (placement === 'left-start') {
      left = a.left - w - offset;
      top = a.top;
    }
    let maxHeight: number | undefined;
    if (placement.startsWith('bottom') && top + h > vh - 8) {
      const above = a.top - h - offset;
      if (above >= 8) top = above;
      else {
        const spaceBelow = vh - (a.top + a.height + offset) - 8;
        const spaceAbove = a.top - offset - 8;
        if (spaceAbove > spaceBelow) {
          maxHeight = spaceAbove;
          top = 8;
        } else maxHeight = spaceBelow;
      }
    }
    if (placement === 'top-start' && top < 8) top = a.top + a.height + offset;
    if (top + Math.min(h, maxHeight || h) > vh - 8) top = Math.max(8, vh - 8 - Math.min(h, maxHeight || h));
    left = Math.max(8, Math.min(left, vw - w - 8));
    top = Math.max(8, top);
    setPos((p) => (p && p.left === left && p.top === top && p.maxHeight === maxHeight ? p : { left, top, maxHeight }));
  }, [anchor, placement, offset]);

  useLayoutEffect(() => {
    place();
  });

  useEffect(() => {
    const entry = { el: ref.current, id: idRef.current };
    stack.push(entry);
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      const idx = stack.findIndex((s) => s.id === entry.id);
      // inside me or inside a popover opened after me (a child) => keep open
      for (let i = idx; i < stack.length; i++) if (stack[i].el?.contains(target)) return;
      if (anchor instanceof HTMLElement && anchor.contains(target)) return;
      onCloseRef.current();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || !closeOnEsc) return;
      if (stack[stack.length - 1]?.id !== entry.id) return;
      e.stopPropagation();
      e.preventDefault();
      onCloseRef.current();
    };
    const onResize = () => place();
    document.addEventListener('mousedown', onDown, true);
    document.addEventListener('keydown', onKey, true);
    window.addEventListener('resize', onResize);
    return () => {
      const i = stack.findIndex((s) => s.id === entry.id);
      if (i >= 0) stack.splice(i, 1);
      document.removeEventListener('mousedown', onDown, true);
      document.removeEventListener('keydown', onKey, true);
      window.removeEventListener('resize', onResize);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const entry = stack.find((s) => s.id === idRef.current);
    if (entry) entry.el = ref.current;
  });

  return createPortal(
    <div
      ref={ref}
      className={'popover ' + className}
      style={{ left: pos?.left ?? -9999, top: pos?.top ?? -9999, width, maxHeight: pos?.maxHeight, visibility: pos ? 'visible' : 'hidden', ...style }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      {children}
    </div>,
    document.body,
  );
}

export function isInsidePopover(node: Node | null) {
  return stack.some((s) => s.el?.contains(node));
}

export function hasOpenPopover() {
  return stack.length > 0;
}

// ---------------------------------------------------------------------------
// Keyboard navigable menu list
// ---------------------------------------------------------------------------

export function useMenuNav(count: number, onSelect: (i: number) => void, deps: unknown[] = []) {
  const [index, setIndex] = useState(0);
  useEffect(() => setIndex(0), deps); // eslint-disable-line react-hooks/exhaustive-deps
  const onKeyDown = (e: React.KeyboardEvent | KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setIndex((i) => (count ? (i + 1) % count : 0));
      return true;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      setIndex((i) => (count ? (i - 1 + count) % count : 0));
      return true;
    }
    if (e.key === 'Enter' || e.key === 'Tab') {
      if (!count) return false;
      e.preventDefault();
      onSelect(index);
      return true;
    }
    return false;
  };
  return { index, setIndex, onKeyDown };
}

export function MenuItem({
  icon,
  label,
  desc,
  right,
  onClick,
  selected,
  danger,
  checked,
  disabled,
  onMouseEnter,
  tall,
  testId,
}: {
  icon?: ReactNode;
  label: ReactNode;
  desc?: ReactNode;
  right?: ReactNode;
  onClick?: (e: React.MouseEvent) => void;
  selected?: boolean;
  danger?: boolean;
  checked?: boolean;
  disabled?: boolean;
  onMouseEnter?: (e: React.MouseEvent<HTMLButtonElement>) => void;
  tall?: boolean;
  testId?: string;
}) {
  const ref = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (selected) ref.current?.scrollIntoView({ block: 'nearest' });
  }, [selected]);
  return (
    <button
      ref={ref}
      type="button"
      data-testid={testId}
      className={`menu-item ${selected ? 'selected' : ''} ${danger ? 'danger' : ''} ${disabled ? 'disabled' : ''} ${tall ? 'tall' : ''}`}
      onClick={onClick}
      onMouseEnter={onMouseEnter}
      onMouseDown={(e) => e.preventDefault()}
    >
      {icon !== undefined && <span className="mi-icon">{icon}</span>}
      <span className="mi-body">
        <div className="ellipsis">{label}</div>
        {desc && <div className="mi-desc">{desc}</div>}
      </span>
      {right && <span className="mi-right">{right}</span>}
      {checked && <span className="check">✓</span>}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Tooltip
// ---------------------------------------------------------------------------

export function Tooltip({ label, kbd, children, placement = 'bottom' }: { label: ReactNode; kbd?: string; children: React.ReactElement<any>; placement?: 'bottom' | 'top' | 'right' }) {
  const [rect, setRect] = useState<DOMRect | null>(null);
  const timer = useRef<number>(0);
  const child = React.Children.only(children);
  const show = (e: React.MouseEvent) => {
    const el = e.currentTarget as HTMLElement;
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setRect(el.getBoundingClientRect()), 500);
  };
  const hide = () => {
    window.clearTimeout(timer.current);
    setRect(null);
  };
  useEffect(() => () => window.clearTimeout(timer.current), []);
  return (
    <>
      {React.cloneElement(child, {
        onMouseEnter: (e: React.MouseEvent) => {
          show(e);
          child.props.onMouseEnter?.(e);
        },
        onMouseLeave: (e: React.MouseEvent) => {
          hide();
          child.props.onMouseLeave?.(e);
        },
        onMouseDown: (e: React.MouseEvent) => {
          hide();
          child.props.onMouseDown?.(e);
        },
      })}
      {rect && <TooltipBubble rect={rect} label={label} kbd={kbd} placement={placement} />}
    </>
  );
}

function TooltipBubble({ rect, label, kbd, placement }: { rect: DOMRect; label: ReactNode; kbd?: string; placement: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: -999, top: -999 });
  useLayoutEffect(() => {
    const el = ref.current!;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    let left = rect.left + rect.width / 2 - w / 2;
    let top = rect.bottom + 6;
    if (placement === 'top') top = rect.top - h - 6;
    if (placement === 'right') {
      left = rect.right + 6;
      top = rect.top + rect.height / 2 - h / 2;
    }
    left = Math.max(6, Math.min(left, window.innerWidth - w - 6));
    if (top + h > window.innerHeight - 4) top = rect.top - h - 6;
    setPos({ left, top });
  }, [rect, placement]);
  return createPortal(
    <div ref={ref} className="tooltip" style={pos}>
      {label}
      {kbd && <span className="kbd">{kbd}</span>}
    </div>,
    document.body,
  );
}

// ---------------------------------------------------------------------------
// Modal
// ---------------------------------------------------------------------------

export function Modal({ onClose, children, width, top = '12vh', className = '', align = 'start' }: { onClose: () => void; children: ReactNode; width?: number | string; top?: string; className?: string; align?: 'start' | 'center' }) {
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => {
    const entry = { el: null as HTMLElement | null, id: ++popSeq };
    stack.push(entry);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && stack[stack.length - 1]?.id === entry.id) {
        e.stopPropagation();
        onCloseRef.current();
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => {
      const i = stack.findIndex((s) => s.id === entry.id);
      if (i >= 0) stack.splice(i, 1);
      document.removeEventListener('keydown', onKey, true);
    };
  }, []);
  return createPortal(
    <div
      className="overlay"
      style={{ paddingTop: align === 'center' ? 0 : top, alignItems: align === 'center' ? 'center' : 'flex-start' }}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className={'modal ' + className} style={{ width }} onMouseDown={(e) => e.stopPropagation()}>
        {children}
      </div>
    </div>,
    document.body,
  );
}

// ---------------------------------------------------------------------------
// Confirm dialog (promise based)
// ---------------------------------------------------------------------------

type ConfirmOpts = { title: string; body?: string; confirm?: string; danger?: boolean };
let confirmSetter: ((v: (ConfirmOpts & { resolve: (b: boolean) => void }) | null) => void) | null = null;

export function confirmDialog(opts: ConfirmOpts): Promise<boolean> {
  return new Promise((resolve) => {
    if (!confirmSetter) return resolve(window.confirm(opts.title));
    confirmSetter({ ...opts, resolve });
  });
}

export function ConfirmHost() {
  const [state, setState] = useState<(ConfirmOpts & { resolve: (b: boolean) => void }) | null>(null);
  useEffect(() => {
    confirmSetter = setState;
    return () => {
      confirmSetter = null;
    };
  }, []);
  if (!state) return null;
  const done = (v: boolean) => {
    state.resolve(v);
    setState(null);
  };
  return (
    <Modal onClose={() => done(false)} width={300} align="center">
      <div style={{ padding: '20px 20px 16px', textAlign: 'center' }} data-testid="confirm-dialog">
        <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 6 }}>{state.title}</div>
        {state.body && <div className="muted" style={{ fontSize: 13, marginBottom: 4 }}>{state.body}</div>}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 16 }}>
          <button className={state.danger ? 'btn btn-lg btn-danger' : 'btn btn-lg btn-primary'} autoFocus onClick={() => done(true)}>
            {state.confirm || 'Confirm'}
          </button>
          <button className="btn btn-lg btn-outline" onClick={() => done(false)}>
            Cancel
          </button>
        </div>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Avatars, page icons, toasts
// ---------------------------------------------------------------------------

export function Avatar({ user, size = 20 }: { user?: Partial<User> | null; size?: number }) {
  if (!user) return <span className="avatar" style={{ width: size, height: size, background: 'var(--text-4)' }} />;
  const initial = (user.name || user.email || '?').trim().charAt(0).toUpperCase();
  if (user.avatarUrl)
    return <span className="avatar" title={user.name} style={{ width: size, height: size, backgroundImage: `url(${user.avatarUrl})` }} />;
  return (
    <span className="avatar" title={user.name} style={{ width: size, height: size, background: user.color || '#999', fontSize: size * 0.5 }}>
      {initial}
    </span>
  );
}

export function PageIcon({ icon, type, size = 18, className = '' }: { icon?: string | null; type?: string; size?: number; className?: string }) {
  if (icon) {
    if (icon.startsWith('/') || icon.startsWith('http'))
      return <img className={'page-icon-img ' + className} src={icon} alt="" style={{ width: size, height: size, borderRadius: 3, objectFit: 'cover' }} />;
    return (
      <span className={'page-icon-emoji ' + className} style={{ fontSize: size * 0.95, lineHeight: 1, width: size, height: size, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
        {icon}
      </span>
    );
  }
  const Icon = type === 'database' ? DbIcon : FileText;
  return <Icon className={className} size={size} strokeWidth={1.6} style={{ color: 'var(--icon)', flexShrink: 0 }} />;
}

export function Toasts() {
  const toasts = useApp((s) => s.toasts);
  const dismiss = useApp((s) => s.dismissToast);
  return createPortal(
    <div className="toasts">
      {toasts.map((t) => (
        <div key={t.id} className={'toast ' + (t.kind === 'error' ? 'error' : '')} role="status">
          <span>{t.message}</span>
          {t.action && (
            <button
              onClick={() => {
                t.action!.run();
                dismiss(t.id);
              }}
            >
              {t.action.label}
            </button>
          )}
        </div>
      ))}
    </div>,
    document.body,
  );
}

export function Switch({ on, onChange, testId }: { on: boolean; onChange: (v: boolean) => void; testId?: string }) {
  return <span role="switch" aria-checked={on} data-testid={testId} className={'switch ' + (on ? 'on' : '')} onClick={() => onChange(!on)} />;
}

/** Hook: returns [anchorRect, open(el), close] for simple popover state. */
export function useAnchor<T = HTMLElement | DOMRect>() {
  const [anchor, setAnchor] = useState<T | null>(null);
  return [anchor, (a: T | null) => setAnchor(a), () => setAnchor(null)] as const;
}

export function Spinner() {
  return <div className="spinner" />;
}

export function Loading({ label }: { label?: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', gap: 8, color: 'var(--text-3)' }}>
      <Spinner />
      {label}
    </div>
  );
}
