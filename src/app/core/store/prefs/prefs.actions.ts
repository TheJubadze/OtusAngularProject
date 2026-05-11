import { createActionGroup, props } from '@ngrx/store';

/**
 * User-preference actions: things the user toggles in the UI that should
 * persist for the session and be observable from anywhere in the app.
 *
 * `createActionGroup` produces a typed object of action creators with a
 * shared source label — Redux DevTools shows them as `[Prefs] Set Vs
 * Currency` etc., which is much more readable than free-form strings.
 */
export const PrefsActions = createActionGroup({
  source: 'Prefs',
  events: {
    'Set Vs Currency': props<{ vsCurrency: string }>(),
  },
});
