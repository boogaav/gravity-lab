import { create } from 'zustand';
import { DEFAULT_UNIVERSE, getUniverse, type UniverseId, type UniverseScheme } from '../ui/universe';

/**
 * Presentation preferences: the UI's light/dark skin and the colour scheme of
 * space itself. Both are remembered per browser and neither touches physics.
 */
export type UiTheme = 'dark' | 'light';

const THEME_KEY = 'gravity-lab-theme';
const UNIVERSE_KEY = 'gravity-lab-universe';

function readTheme(): UiTheme {
  if (typeof localStorage === 'undefined') return 'dark';
  const stored = localStorage.getItem(THEME_KEY);
  if (stored === 'light' || stored === 'dark') return stored;
  // fall back to the OS preference on first visit
  return typeof matchMedia !== 'undefined' && matchMedia('(prefers-color-scheme: light)').matches
    ? 'light'
    : 'dark';
}

function readUniverse(): UniverseId {
  if (typeof localStorage === 'undefined') return DEFAULT_UNIVERSE;
  return getUniverse(localStorage.getItem(UNIVERSE_KEY)).id;
}

interface ThemeState {
  theme: UiTheme;
  universe: UniverseId;
}

export const useTheme = create<ThemeState>(() => ({
  theme: readTheme(),
  universe: readUniverse(),
}));

/** Current universe scheme object (for non-React code such as the 3D scene). */
export const currentUniverse = (): UniverseScheme => getUniverse(useTheme.getState().universe);

function applyTheme(theme: UiTheme): void {
  if (typeof document === 'undefined') return;
  document.documentElement.dataset.theme = theme;
}

export const themeActions = {
  setTheme(theme: UiTheme) {
    useTheme.setState({ theme });
    applyTheme(theme);
    try {
      localStorage.setItem(THEME_KEY, theme);
    } catch {
      /* private browsing */
    }
  },

  toggleTheme() {
    themeActions.setTheme(useTheme.getState().theme === 'dark' ? 'light' : 'dark');
  },

  setUniverse(universe: UniverseId) {
    useTheme.setState({ universe });
    try {
      localStorage.setItem(UNIVERSE_KEY, universe);
    } catch {
      /* private browsing */
    }
  },
};

// apply the stored skin as early as possible
applyTheme(useTheme.getState().theme);
