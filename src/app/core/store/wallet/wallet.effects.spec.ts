import { TestBed } from '@angular/core/testing';
import { Action } from '@ngrx/store';
import { provideMockActions } from '@ngrx/effects/testing';
import { Observable, ReplaySubject, of, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { WalletApi } from '../../data/wallet-api';
import { Holding, Transaction } from '../../domain';
import { WalletActions } from './wallet.actions';
import { WalletEffects } from './wallet.effects';

/**
 * Hand-rolled stub instead of HttpTestingController so each test stays
 * focused on the effect's branching rather than HTTP plumbing details.
 */
class WalletApiStub implements Partial<WalletApi> {
  listHoldings = vi.fn<() => Observable<Holding[]>>();
  createHolding = vi.fn<(h: Holding) => Observable<Holding>>();
  updateHolding = vi.fn<(id: string, p: Partial<Holding>) => Observable<Holding>>();
  deleteHolding = vi.fn<(id: string) => Observable<void>>();
  listTransactions = vi.fn<() => Observable<Transaction[]>>();
  createTransaction = vi.fn<(t: Transaction) => Observable<Transaction>>();
}

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

describe('WalletEffects', () => {
  let actions$: ReplaySubject<Action>;
  let effects: WalletEffects;
  let api: WalletApiStub;

  beforeEach(() => {
    actions$ = new ReplaySubject<Action>(1);
    api = new WalletApiStub();

    TestBed.configureTestingModule({
      providers: [
        WalletEffects,
        provideMockActions(() => actions$),
        { provide: WalletApi, useValue: api },
      ],
    });

    effects = TestBed.inject(WalletEffects);
  });

  describe('deposit$', () => {
    it('PATCHes an existing holding by coinId', () => {
      const existing = makeHolding({ amount: 1 });
      api.listHoldings.mockReturnValue(of([existing]));
      api.updateHolding.mockImplementation((id, patch) =>
        of({ ...existing, ...patch, id }),
      );
      api.createTransaction.mockImplementation((tx) => of(tx));

      let emitted: Action | undefined;
      effects.deposit$.subscribe((a) => (emitted = a));

      actions$.next(
        WalletActions.deposit({
          coinId: 'bitcoin',
          symbol: 'BTC',
          name: 'Bitcoin',
          amount: 0.5,
        }),
      );

      expect(api.updateHolding).toHaveBeenCalledTimes(1);
      expect(api.createHolding).not.toHaveBeenCalled();
      const [id, patch] = api.updateHolding.mock.calls[0];
      expect(id).toBe('h1');
      expect(patch.amount).toBeCloseTo(1.5);

      expect(emitted?.type).toBe('[Wallet] Mutation Success');
      const ok = emitted as ReturnType<typeof WalletActions.mutationSuccess>;
      expect(ok.holding.amount).toBeCloseTo(1.5);
      expect(ok.transaction.kind).toBe('deposit');
      expect(ok.removed).toBeUndefined();
    });

    it('POSTs a fresh holding when coinId is not yet held', () => {
      api.listHoldings.mockReturnValue(of([]));
      api.createHolding.mockImplementation((h) => of(h));
      api.createTransaction.mockImplementation((tx) => of(tx));

      let emitted: Action | undefined;
      effects.deposit$.subscribe((a) => (emitted = a));

      actions$.next(
        WalletActions.deposit({
          coinId: 'solana',
          symbol: 'SOL',
          name: 'Solana',
          amount: 5,
        }),
      );

      expect(api.createHolding).toHaveBeenCalledTimes(1);
      expect(api.updateHolding).not.toHaveBeenCalled();
      const posted = api.createHolding.mock.calls[0][0];
      expect(posted.coinId).toBe('solana');
      expect(posted.amount).toBe(5);
      expect(posted.id).toBeTruthy();
      expect(emitted?.type).toBe('[Wallet] Mutation Success');
    });

    it('emits Mutation Failure when listHoldings errors out', () => {
      api.listHoldings.mockReturnValue(
        throwError(() => new Error('backend down')),
      );

      let emitted: Action | undefined;
      effects.deposit$.subscribe((a) => (emitted = a));

      actions$.next(
        WalletActions.deposit({
          coinId: 'bitcoin',
          symbol: 'BTC',
          name: 'Bitcoin',
          amount: 1,
        }),
      );

      expect(emitted?.type).toBe('[Wallet] Mutation Failure');
      const fail = emitted as ReturnType<typeof WalletActions.mutationFailure>;
      expect(fail.error).toBe('backend down');
    });
  });

  describe('send$', () => {
    it('PATCHes a partial send and emits Mutation Success', () => {
      const existing = makeHolding({ amount: 2 });
      api.listHoldings.mockReturnValue(of([existing]));
      api.updateHolding.mockImplementation((id, patch) =>
        of({ ...existing, ...patch, id }),
      );
      api.createTransaction.mockImplementation((tx) => of(tx));

      let emitted: Action | undefined;
      effects.send$.subscribe((a) => (emitted = a));

      actions$.next(
        WalletActions.send({
          coinId: 'bitcoin',
          symbol: 'BTC',
          name: 'Bitcoin',
          amount: 0.5,
        }),
      );

      const patch = api.updateHolding.mock.calls[0][1];
      expect(patch.amount).toBeCloseTo(1.5);
      expect(api.deleteHolding).not.toHaveBeenCalled();

      const ok = emitted as ReturnType<typeof WalletActions.mutationSuccess>;
      expect(ok.removed).toBe(false);
      expect(ok.transaction.kind).toBe('send');
    });

    it('DELETEs the record when the send drains the balance', () => {
      const existing = makeHolding({ amount: 0.5 });
      api.listHoldings.mockReturnValue(of([existing]));
      api.deleteHolding.mockReturnValue(of(undefined));
      api.createTransaction.mockImplementation((tx) => of(tx));

      let emitted: Action | undefined;
      effects.send$.subscribe((a) => (emitted = a));

      actions$.next(
        WalletActions.send({
          coinId: 'bitcoin',
          symbol: 'BTC',
          name: 'Bitcoin',
          amount: 0.5,
        }),
      );

      expect(api.deleteHolding).toHaveBeenCalledWith('h1');
      expect(api.updateHolding).not.toHaveBeenCalled();
      const ok = emitted as ReturnType<typeof WalletActions.mutationSuccess>;
      expect(ok.removed).toBe(true);
    });

    it('emits Mutation Failure when amount exceeds the held balance', () => {
      api.listHoldings.mockReturnValue(of([makeHolding({ amount: 0.5 })]));

      let emitted: Action | undefined;
      effects.send$.subscribe((a) => (emitted = a));

      actions$.next(
        WalletActions.send({
          coinId: 'bitcoin',
          symbol: 'BTC',
          name: 'Bitcoin',
          amount: 1,
        }),
      );

      expect(api.updateHolding).not.toHaveBeenCalled();
      expect(api.deleteHolding).not.toHaveBeenCalled();
      expect(api.createTransaction).not.toHaveBeenCalled();
      const fail = emitted as ReturnType<typeof WalletActions.mutationFailure>;
      expect(fail.type).toBe('[Wallet] Mutation Failure');
      expect(fail.error).toBe('Not enough balance');
    });

    it('emits Mutation Failure when the coin is not held at all', () => {
      api.listHoldings.mockReturnValue(of([]));

      let emitted: Action | undefined;
      effects.send$.subscribe((a) => (emitted = a));

      actions$.next(
        WalletActions.send({
          coinId: 'cardano',
          symbol: 'ADA',
          name: 'Cardano',
          amount: 0.01,
        }),
      );

      const fail = emitted as ReturnType<typeof WalletActions.mutationFailure>;
      expect(fail.error).toBe('Not enough balance');
    });
  });

  describe('load effects', () => {
    it('maps listHoldings success into Load Holdings Success', () => {
      const rows = [makeHolding(), makeHolding({ id: 'h2', coinId: 'ethereum' })];
      api.listHoldings.mockReturnValue(of(rows));

      let emitted: Action | undefined;
      effects.loadHoldings$.subscribe((a) => (emitted = a));

      actions$.next(WalletActions.loadHoldings());

      expect(emitted?.type).toBe('[Wallet] Load Holdings Success');
      const ok = emitted as ReturnType<
        typeof WalletActions.loadHoldingsSuccess
      >;
      expect(ok.holdings).toEqual(rows);
    });

    it('maps listHoldings failure into Load Holdings Failure', () => {
      api.listHoldings.mockReturnValue(throwError(() => new Error('500')));

      let emitted: Action | undefined;
      effects.loadHoldings$.subscribe((a) => (emitted = a));

      actions$.next(WalletActions.loadHoldings());

      const fail = emitted as ReturnType<
        typeof WalletActions.loadHoldingsFailure
      >;
      expect(fail.type).toBe('[Wallet] Load Holdings Failure');
      expect(fail.error).toBe('500');
    });
  });
});
