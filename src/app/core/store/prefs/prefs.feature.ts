import { createFeature, createReducer, on } from '@ngrx/store';

import { PrefsActions } from './prefs.actions';

export interface PrefsState {
  readonly vsCurrency: string;
}

const initialState: PrefsState = {
  vsCurrency: 'usd',
};

/**
 * createFeature is the modern NgRx idiom: state shape + reducer in one
 * place, and selectors are auto-generated for every top-level field.
 * Consumers get `prefsFeature.selectVsCurrency` for free — no manual
 * `createSelector` boilerplate. The `name` is the key under which this
 * slice mounts in the root state, and what shows up in Redux DevTools.
 */
export const prefsFeature = createFeature({
  name: 'prefs',
  reducer: createReducer(
    initialState,
    on(PrefsActions.setVsCurrency, (state, { vsCurrency }) => ({
      ...state,
      vsCurrency: vsCurrency.toLowerCase(),
    })),
  ),
});
