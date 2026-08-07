import { themeActions, useTheme } from '../state/theme';
import { UNIVERSES } from '../ui/universe';

/** Light/dark rocker for the interface chrome, for use inside the Look menu. */
export function ThemeToggle() {
  const theme = useTheme((s) => s.theme);
  return (
    <div className="theme-rocker" data-keep-open>
      {(['dark', 'light'] as const).map((t) => (
        <button
          key={t}
          className={`btn btn-music ${theme === t ? 'active' : ''}`}
          onClick={() => themeActions.setTheme(t)}
          data-tip-title={t === 'dark' ? 'Dark interface' : 'Light interface'}
          data-tip="Skins the panels and controls. Space keeps whatever colour scheme you picked — the two are independent."
        >
          {t === 'dark' ? '☾ Dark' : '☀ Light'}
        </button>
      ))}
    </div>
  );
}

/** The list of universe colour schemes, for use inside the Look menu. */
export function UniverseOptions() {
  const universe = useTheme((s) => s.universe);
  return (
    <div className="universe-list">
      {UNIVERSES.map((u) => (
        <button
          key={u.id}
          className={`universe-option ${u.id === universe ? 'active' : ''}`}
          onClick={() => themeActions.setUniverse(u.id)}
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
  );
}

/** Small swatch of the active scheme, shown on the Look menu button. */
export function UniverseSwatch() {
  const universe = useTheme((s) => s.universe);
  const active = UNIVERSES.find((u) => u.id === universe) ?? UNIVERSES[0];
  return <span className="universe-swatch" style={{ background: active.void, borderColor: active.gridMajor }} />;
}
