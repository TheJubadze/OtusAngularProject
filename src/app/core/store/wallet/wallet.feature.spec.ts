import { describe, expect, it } from 'vitest';

import { Holding, Transaction } from '../../domain';
import { WalletActions } from './wallet.actions';
import { walletFeature } from './wallet.feature';

const reducer = walletFeature.reducer;
const initAction = { type: '@@INIT' } as never;

function makeHolding(over: Partial<Holding> = {}): Holding {
  return {
    id: 'h1',
    coinId: 'bitcoin',
    symbol: 'BTC',
    name: 'Bitcoin',
    amount: 1,
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...over,
  };
}

function makeTransaction(over: Partial<Transaction> = {}): Transaction {
  return {
    id: 't1',
    coinId: 'bitcoin',
    symbol: 'BTC',
    kind: 'deposit',
    amount: 1,
    createdAt: '2026-01-01T00:00:00.000Z',
    ...over,
  };
}

describe('walletFeature reducer', () => {
  it('starts empty', () => {
    const state = reducer(undefined, initAction);
    expect(state.holdings).toEqual([]);
    expect(state.transactions).toEqual([]);
    expect(state.loadingHoldings).toBe(false);
    expect(state.error).toBeNull();
  });

  it('toggles loadingHoldings around Load Holdings', () => {
    const start = reducer(undefined, initAction);
    const loading = reducer(start, WalletActions.loadHoldings());
    expect(loading.loadingHoldings).toBe(true);
    expect(loading.error).toBeNull();

    const loaded = reducer(
      loading,
      WalletActions.loadHoldingsSuccess({ holdings: [makeHolding()] }),
    );
    expect(loaded.loadingHoldings).toBe(false);
    expect(loaded.holdings).toHaveLength(1);
  });

  it('captures the error message on Load Holdings Failure', () => {
    const start = reducer(undefined, WalletActions.loadHoldings());
    const failed = reducer(
      start,
      WalletActions.loadHoldingsFailure({ error: 'boom' }),
    );
    expect(failed.loadingHoldings).toBe(false);
    expect(failed.error).toBe('boom');
  });

  describe('Mutation Success', () => {
    it('appends a brand-new holding and prepends its transaction', () => {
      const start = reducer(undefined, initAction);
      const next = reducer(
        start,
        WalletActions.mutationSuccess({
          holding: makeHolding({ coinId: 'ethereum', symbol: 'ETH' }),
          transaction: makeTransaction({
            coinId: 'ethereum',
            symbol: 'ETH',
            id: 't-new',
          }),
        }),
      );
      expect(next.holdings.map((h) => h.coinId)).toEqual(['ethereum']);
      expect(next.transactions[0].id).toBe('t-new');
      expect(next.mutating).toBe(false);
    });

    it('replaces (not duplicates) when an existing coinId is upserted', () => {
      const seeded = reducer(
        undefined,
        WalletActions.loadHoldingsSuccess({
          holdings: [
            makeHolding({ id: 'h-btc', coinId: 'bitcoin', amount: 0.5 }),
            makeHolding({ id: 'h-eth', coinId: 'ethereum', amount: 4 }),
          ],
        }),
      );
      const next = reducer(
        seeded,
        WalletActions.mutationSuccess({
          holding: makeHolding({
            id: 'h-btc',
            coinId: 'bitcoin',
            amount: 1.5,
          }),
          transaction: makeTransaction({ id: 't-deposit' }),
        }),
      );
      expect(next.holdings).toHaveLength(2);
      const btc = next.holdings.find((h) => h.coinId === 'bitcoin');
      expect(btc?.amount).toBe(1.5);
    });

    it('drops the holding entirely when removed: true', () => {
      const seeded = reducer(
        undefined,
        WalletActions.loadHoldingsSuccess({
          holdings: [
            makeHolding({ id: 'h-btc', coinId: 'bitcoin', amount: 0.5 }),
            makeHolding({ id: 'h-eth', coinId: 'ethereum', amount: 4 }),
          ],
        }),
      );
      const next = reducer(
        seeded,
        WalletActions.mutationSuccess({
          holding: makeHolding({
            id: 'h-btc',
            coinId: 'bitcoin',
            amount: 0,
          }),
          transaction: makeTransaction({
            id: 't-drain',
            kind: 'send',
            amount: 0.5,
          }),
          removed: true,
        }),
      );
      expect(next.holdings.map((h) => h.coinId)).toEqual(['ethereum']);
      expect(next.transactions[0].kind).toBe('send');
    });

    it('sets `mutating` on Deposit/Send and clears it on Mutation Success', () => {
      const start = reducer(undefined, initAction);
      const mid = reducer(
        start,
        WalletActions.deposit({
          coinId: 'bitcoin',
          symbol: 'BTC',
          name: 'Bitcoin',
          amount: 1,
        }),
      );
      expect(mid.mutating).toBe(true);

      const after = reducer(
        mid,
        WalletActions.mutationSuccess({
          holding: makeHolding(),
          transaction: makeTransaction(),
        }),
      );
      expect(after.mutating).toBe(false);
    });
  });

  describe('Selection and search', () => {
    it('stores the selected coin id', () => {
      const next = reducer(
        undefined,
        WalletActions.setSelectedCoin({ coinId: 'bitcoin' }),
      );
      expect(next.selectedCoinId).toBe('bitcoin');
    });

    it('clears selection when coinId is null', () => {
      const a = reducer(
        undefined,
        WalletActions.setSelectedCoin({ coinId: 'bitcoin' }),
      );
      const b = reducer(a, WalletActions.setSelectedCoin({ coinId: null }));
      expect(b.selectedCoinId).toBeNull();
    });

    it('updates the search term', () => {
      const next = reducer(
        undefined,
        WalletActions.setSearch({ search: 'btc' }),
      );
      expect(next.search).toBe('btc');
    });
  });
});
