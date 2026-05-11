import { beforeEach, describe, expect, it } from 'vitest';

import { PrefsActions } from './prefs.actions';
import { prefsFeature } from './prefs.feature';

describe('prefsFeature reducer', () => {
  const reducer = prefsFeature.reducer;
  const initAction = { type: '@@INIT' } as never;

  beforeEach(() => {
    /**
     * `loadInitial()` reads from window.localStorage at module init. In a
     * fresh jsdom we wipe between tests so each one sees a clean default.
     */
    if (typeof window !== 'undefined') {
      window.localStorage.clear();
    }
  });

  it('starts with usd + dark when storage is empty', () => {
    const state = reducer(undefined, initAction);
    expect(state.vsCurrency).toBe('usd');
    expect(state.theme).toBe('dark');
  });

  it('lowercases the vsCurrency on Set Vs Currency', () => {
    const state = reducer(
      reducer(undefined, initAction),
      PrefsActions.setVsCurrency({ vsCurrency: 'EUR' }),
    );
    expect(state.vsCurrency).toBe('eur');
  });

  it('writes the theme on Set Theme', () => {
    const state = reducer(
      reducer(undefined, initAction),
      PrefsActions.setTheme({ theme: 'light' }),
    );
    expect(state.theme).toBe('light');
  });

  it('flips the theme on Toggle Theme', () => {
    const start = reducer(undefined, initAction);
    const once = reducer(start, PrefsActions.toggleTheme());
    expect(once.theme).toBe('light');
    const twice = reducer(once, PrefsActions.toggleTheme());
    expect(twice.theme).toBe('dark');
  });

  it('leaves unrelated fields untouched on each mutation', () => {
    const start = reducer(undefined, initAction);
    const afterCurrency = reducer(
      start,
      PrefsActions.setVsCurrency({ vsCurrency: 'rub' }),
    );
    expect(afterCurrency.theme).toBe(start.theme);

    const afterTheme = reducer(
      afterCurrency,
      PrefsActions.setTheme({ theme: 'light' }),
    );
    expect(afterTheme.vsCurrency).toBe('rub');
  });
});
