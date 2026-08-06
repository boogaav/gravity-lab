import { useEffect, useRef, useState } from 'react';
import { themeActions, useTheme } from '../state/theme';
import { UNIVERSES } from '../ui/universe';

/** Light/dark skin toggle for the interface chrome. */
export function ThemeToggle() {
  const theme = useTheme((s) => s.theme);
  return (
    <button
      className="btn"
      onClick={themeActions.toggleTheme}
      data-tip-title={theme === 'dark' ? 'Light mode' : 'Dark mode'}
      data-tip="Switches the interface between dark and light. Space keeps whatever colour scheme you picked — the two are independent."
    >
      {theme === 'dark' ? '☀ Light' : '☾ Dark'}
    </button>
  );
}

/** Picker for how space itself is drawn. */
export function UniversePicker() {
  const universe = useTheme((s) => s.universe);
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const active = UNIVERSES.find((u) => u.id === universe) ?? UNIVERSES[0];

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
    <div className="universe-wrap" ref={wrap}>
      <button
        className="btn"
        onClick={() => setOpen((v) => !v)}
        data-tip-title="Universe colours"
        data-tip="Changes how space is drawn — the void, the reference grid, the stars and the analysis overlays. Purely visual; the simulation is identical in every scheme."
      >
        <span className="universe-swatch" style={{ background: active.void, borderColor: active.gridMajor }} />
        {active.name}
      </button>
      {open && (
        <div className="universe-pop">
          {UNIVERSES.map((u) => (
            <button
              key={u.id}
              className={`universe-option ${u.id === universe ? 'active' : ''}`}
              onClick={() => {
                themeActions.setUniverse(u.id);
                setOpen(false);
              }}
            >
              <span
                className="universe-preview"
                style={{ background: u.void, borderColor: u.gridMajor }}
                aria-hidden
              >
                <i style={{ background: u.gridMajor }} />
                <i style={{ background: u.closestApproach }} />
                <i style={{ background: u.ink }} />
              </span>
              <span className="universe-text">
                <b>{u.name}</b>
                <em>{u.blurb}</em>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
