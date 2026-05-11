import { createFeature, createReducer, on } from '@ngrx/store';

import { Holding, Transaction } from '../../domain';
import { WalletActions } from './wallet.actions';

export interface WalletState {
  readonly holdings: readonly Holding[];
  readonly transactions: readonly Transaction[];
  readonly loadingHoldings: boolean;
  readonly loadingTransactions: boolean;
  readonly mutating: boolean;
  readonly error: string | null;
  readonly selectedCoinId: string | null;
  readonly search: string;
}

const initialState: WalletState = {
  holdings: [],
  transactions: [],
  loadingHoldings: false,
  loadingTransactions: false,
  mutating: false,
  error: null,
  selectedCoinId: null,
  search: '',
};

export const walletFeature = createFeature({
  name: 'wallet',
  reducer: createReducer(
    initialState,

    on(WalletActions.loadHoldings, (s) => ({
      ...s,
      loadingHoldings: true,
      error: null,
    })),
    on(WalletActions.loadHoldingsSuccess, (s, { holdings }) => ({
      ...s,
      holdings,
      loadingHoldings: false,
    })),
    on(WalletActions.loadHoldingsFailure, (s, { error }) => ({
      ...s,
      loadingHoldings: false,
      error,
    })),

    on(WalletActions.loadTransactions, (s) => ({
      ...s,
      loadingTransactions: true,
    })),
    on(WalletActions.loadTransactionsSuccess, (s, { transactions }) => ({
      ...s,
      transactions,
      loadingTransactions: false,
    })),
    on(WalletActions.loadTransactionsFailure, (s, { error }) => ({
      ...s,
      loadingTransactions: false,
      error,
    })),

    on(WalletActions.deposit, WalletActions.send, (s) => ({
      ...s,
      mutating: true,
      error: null,
    })),
    /**
     * One reducer for both deposit and send. The effect computes the
     * resulting holding (with new amount) or marks `removed: true` when
     * a send drained the balance to zero; we just replace/drop and prepend
     * the new transaction. Transactions stay newest-first to match the
     * server-side `_sort=createdAt&_order=desc`.
     */
    on(
      WalletActions.mutationSuccess,
      (s, { holding, transaction, removed }) => {
        const filtered = s.holdings.filter((h) => h.coinId !== holding.coinId);
        const holdings = removed ? filtered : [...filtered, holding];
        return {
          ...s,
          holdings,
          transactions: [transaction, ...s.transactions],
          mutating: false,
        };
      },
    ),
    on(WalletActions.mutationFailure, (s, { error }) => ({
      ...s,
      mutating: false,
      error,
    })),

    on(WalletActions.setSelectedCoin, (s, { coinId }) => ({
      ...s,
      selectedCoinId: coinId,
    })),
    on(WalletActions.setSearch, (s, { search }) => ({ ...s, search })),
    on(WalletActions.clearError, (s) => ({ ...s, error: null })),
  ),
});
