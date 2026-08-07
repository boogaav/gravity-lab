import { useEffect, useRef, useState, type ReactNode } from 'react';

/**
 * A toolbar category: one button that opens a small panel of related controls.
 * Keeps the top bar to a handful of primary actions instead of a wall of buttons.
 *
 * Clicking an action inside closes the menu; toggles and inputs marked
 * `data-keep-open` leave it open so you can make several changes at once.
 */
export default function ToolbarMenu({
  label,
  tipTitle,
  tip,
  children,
  className = '',
  width,
}: {
  label: ReactNode;
  tipTitle: string;
  tip: string;
  children: ReactNode;
  className?: string;
  width?: number;
}) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('pointerdown', close);
    window.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('pointerdown', close);
      window.removeEventListener('keydown', esc);
    };
  }, [open]);

  return (
    <div className={`menu-wrap ${className}`} ref={wrap}>
      <button
        className={`btn menu-btn ${open ? 'open' : ''}`}
        onClick={() => setOpen((v) => !v)}
        data-tip-title={tipTitle}
        data-tip={tip}
      >
        {label}
        <span className="menu-caret" aria-hidden>▾</span>
      </button>
      {open && (
        <div
          className="menu-pop"
          style={width ? { width } : undefined}
          onClick={(e) => {
            const el = (e.target as HTMLElement).closest('button, a');
            if (el && !el.closest('[data-keep-open]')) setOpen(false);
          }}
        >
          {children}
        </div>
      )}
    </div>
  );
}

/** Label + control row inside a menu. */
export function MenuRow({ children }: { children: ReactNode }) {
  return <div className="menu-row">{children}</div>;
}

export function MenuLabel({ children }: { children: ReactNode }) {
  return <div className="menu-label">{children}</div>;
}
