import { DOCUMENT } from '@angular/common';
import { Injectable, inject } from '@angular/core';
import { Actions, createEffect, ofType } from '@ngrx/effects';
import { Store } from '@ngrx/store';
import { distinctUntilChanged, tap, withLatestFrom } from 'rxjs';

import { PrefsActions } from './prefs.actions';
import { PREFS_STORAGE_KEY, prefsFeature } from './prefs.feature';

/**
 * Side effects for the prefs slice: write the current state to
 * localStorage whenever it changes, and reflect the active theme on
 * `<html data-theme>` so the global CSS variable layer in styles.scss
 * picks up the right palette. Neither effect dispatches further actions,
 * hence `dispatch: false`.
 */
@Injectable()
export class PrefsEffects {
  private readonly actions$ = inject(Actions);
  private readonly store = inject(Store);
  private readonly doc = inject(DOCUMENT);

  /**
   * Apply the current theme to `<html data-theme>`. Subscribing to the
   * store selector means this fires once on bootstrap with the hydrated
   * initial state, then on every subsequent change — no separate "init"
   * action needed.
   */
  applyTheme$ = createEffect(
    () =>
      this.store.select(prefsFeature.selectTheme).pipe(
        distinctUntilChanged(),
        tap((theme) => {
          this.doc.documentElement.dataset['theme'] = theme;
        }),
      ),
    { dispatch: false },
  );

  /**
   * Persist after every mutation. `withLatestFrom` runs AFTER reducers,
   * so the store snapshot reflects the change we just dispatched.
   * Guarded for non-browser environments so SSR/tests don't blow up.
   */
  persist$ = createEffect(
    () =>
      this.actions$.pipe(
        ofType(
          PrefsActions.setVsCurrency,
          PrefsActions.setTheme,
          PrefsActions.toggleTheme,
        ),
        withLatestFrom(this.store.select(prefsFeature.selectPrefsState)),
        tap(([, state]) => {
          if (typeof window === 'undefined') return;
          try {
            window.localStorage.setItem(
              PREFS_STORAGE_KEY,
              JSON.stringify(state),
            );
          } catch {
            // Quota exceeded or storage disabled — nothing actionable
            // from the app side, drop silently.
          }
        }),
      ),
    { dispatch: false },
  );
}
