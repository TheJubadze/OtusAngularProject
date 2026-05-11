import { createFeature, createReducer, on } from '@ngrx/store';

import { PrefsActions, Theme } from './prefs.actions';

export interface PrefsState {
  readonly vsCurrency: string;
  readonly theme: Theme;
}

const STORAGE_KEY = 'crypto-platform:prefs';

const defaultState: PrefsState = {
  vsCurrency: 'usd',
  theme: 'dark',
};

/**
 * Hydrate prefs from localStorage on app boot so the user's last theme
 * and currency choice survive a reload. Anything malformed is silently
 * dropped — we don't want a single bad key to wedge the entire app.
 * Guarded for non-browser execution (SSR / tests) by checking `window`.
 */
function loadInitial(): PrefsState {
  if (typeof window === 'undefined') return defaultState;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultState;
    const parsed = JSON.parse(raw) as Partial<PrefsState>;
    return {
      vsCurrency:
        typeof parsed.vsCurrency === 'string'
          ? parsed.vsCurrency
          : defaultState.vsCurrency,
      theme: parsed.theme === 'light' ? 'light' : 'dark',
    };
  } catch {
    return defaultState;
  }
}

export const PREFS_STORAGE_KEY = STORAGE_KEY;

/**
 * createFeature is the modern NgRx idiom: state shape + reducer in one
 * place, and selectors are auto-generated for every top-level field.
 * Consumers get `prefsFeature.selectVsCurrency` / `selectTheme` for free
 * — no manual `createSelector` boilerplate. The `name` is the key under
 * which this slice mounts in the root state, and what shows up in
 * Redux DevTools.
 */
export const prefsFeature = createFeature({
  name: 'prefs',
  reducer: createReducer(
    loadInitial(),
    on(PrefsActions.setVsCurrency, (state, { vsCurrency }) => ({
      ...state,
      vsCurrency: vsCurrency.toLowerCase(),
    })),
    on(PrefsActions.setTheme, (state, { theme }) => ({ ...state, theme })),
    on(PrefsActions.toggleTheme, (state) => ({
      ...state,
      theme: state.theme === 'dark' ? 'light' : 'dark',
    })),
  ),
});
