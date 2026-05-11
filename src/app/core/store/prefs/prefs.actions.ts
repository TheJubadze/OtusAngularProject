import { createActionGroup, emptyProps, props } from '@ngrx/store';

export type Theme = 'dark' | 'light';

/**
 * User-preference actions: things the user toggles in the UI that should
 * persist for the session and be observable from anywhere in the app.
 *
 * `createActionGroup` produces a typed object of action creators with a
 * shared source label — Redux DevTools shows them as `[Prefs] Set Vs
 * Currency` etc., which is much more readable than free-form strings.
 *
 * `Theme` lives here (rather than alongside the state shape in feature.ts)
 * to avoid an actions ↔ feature import cycle — feature.ts already imports
 * PrefsActions, so anything used by both files must live with the actions.
 */
export const PrefsActions = createActionGroup({
  source: 'Prefs',
  events: {
    'Set Vs Currency': props<{ vsCurrency: string }>(),
    'Set Theme': props<{ theme: Theme }>(),
    /**
     * UI-friendly variant: dispatched by the header toggle when the
     * current value isn't synchronously known at the call site (Angular
     * template action-expressions don't allow the async pipe, so the
     * click handler can't read theme$ inline). The reducer flips it.
     */
    'Toggle Theme': emptyProps(),
  },
});
