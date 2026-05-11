import { Injectable, inject } from '@angular/core';
import { Actions, createEffect, ofType } from '@ngrx/effects';
import {
  Observable,
  catchError,
  forkJoin,
  map,
  mergeMap,
  of,
  switchMap,
} from 'rxjs';

import { WalletApi } from '../../data/wallet-api';
import { CryptoError, Holding, Transaction } from '../../domain';
import { WalletActions } from './wallet.actions';

@Injectable()
export class WalletEffects {
  private readonly actions$ = inject(Actions);
  private readonly api = inject(WalletApi);

  loadHoldings$ = createEffect(() =>
    this.actions$.pipe(
      ofType(WalletActions.loadHoldings),
      switchMap(() =>
        this.api.listHoldings().pipe(
          map((holdings) => WalletActions.loadHoldingsSuccess({ holdings })),
          catchError((err) =>
            of(WalletActions.loadHoldingsFailure({ error: toMessage(err) })),
          ),
        ),
      ),
    ),
  );

  loadTransactions$ = createEffect(() =>
    this.actions$.pipe(
      ofType(WalletActions.loadTransactions),
      switchMap(() =>
        this.api.listTransactions().pipe(
          map((transactions) =>
            WalletActions.loadTransactionsSuccess({ transactions }),
          ),
          catchError((err) =>
            of(WalletActions.loadTransactionsFailure({ error: toMessage(err) })),
          ),
        ),
      ),
    ),
  );

  /**
   * Deposit: refetch the authoritative holdings list from the server, decide
   * upsert based on what's actually there, then PATCH or POST. Using a fresh
   * GET (rather than the store) eliminates the class of bugs where the store
   * is stale or empty — e.g. when an initial load failed because json-server
   * wasn't up yet, a subsequent deposit must NOT think the coin is unheld.
   * `mergeMap` (not `switchMap`) so concurrent deposits each finish.
   */
  deposit$ = createEffect(() =>
    this.actions$.pipe(
      ofType(WalletActions.deposit),
      mergeMap(({ coinId, symbol, name, amount, note }) =>
        this.api.listHoldings().pipe(
          mergeMap((holdings) => {
            const existing = holdings.find((h) => h.coinId === coinId);
            const now = new Date().toISOString();
            const holding$: Observable<Holding> = existing
              ? this.api.updateHolding(existing.id, {
                  amount: roundAmount(existing.amount + amount),
                  updatedAt: now,
                })
              : this.api.createHolding({
                  id: newId(),
                  coinId,
                  symbol,
                  name,
                  amount,
                  updatedAt: now,
                });
            const transaction$: Observable<Transaction> = this.api.createTransaction({
              id: newId(),
              coinId,
              symbol,
              kind: 'deposit',
              amount,
              ...(note ? { note } : {}),
              createdAt: now,
            });
            return forkJoin({ holding: holding$, transaction: transaction$ }).pipe(
              map(({ holding, transaction }) =>
                WalletActions.mutationSuccess({ holding, transaction }),
              ),
            );
          }),
          catchError((err) =>
            of(WalletActions.mutationFailure({ error: toMessage(err) })),
          ),
        ),
      ),
    ),
  );

  /**
   * Send: same "fetch fresh, then mutate" shape as deposit. Balance check
   * runs against the server-side amount, not the (possibly stale) store, so
   * the user can't accidentally over-send when the store is out of sync.
   * Drains to zero → DELETE the record; otherwise PATCH the new amount.
   */
  send$ = createEffect(() =>
    this.actions$.pipe(
      ofType(WalletActions.send),
      mergeMap(({ coinId, symbol, amount, note }) =>
        this.api.listHoldings().pipe(
          mergeMap((holdings) => {
            const existing = holdings.find((h) => h.coinId === coinId);
            if (!existing || existing.amount < amount) {
              return of(
                WalletActions.mutationFailure({ error: 'Not enough balance' }),
              );
            }
            const now = new Date().toISOString();
            const newAmount = roundAmount(existing.amount - amount);
            const removed = newAmount <= 0;
            const holding$: Observable<Holding> = removed
              ? this.api
                  .deleteHolding(existing.id)
                  .pipe(map(() => ({ ...existing, amount: 0, updatedAt: now })))
              : this.api.updateHolding(existing.id, {
                  amount: newAmount,
                  updatedAt: now,
                });
            const transaction$: Observable<Transaction> = this.api.createTransaction({
              id: newId(),
              coinId,
              symbol,
              kind: 'send',
              amount,
              ...(note ? { note } : {}),
              createdAt: now,
            });
            return forkJoin({ holding: holding$, transaction: transaction$ }).pipe(
              map(({ holding, transaction }) =>
                WalletActions.mutationSuccess({
                  holding: removed
                    ? holding
                    : { ...holding, amount: newAmount, updatedAt: now },
                  transaction,
                  removed,
                }),
              ),
            );
          }),
          catchError((err) =>
            of(WalletActions.mutationFailure({ error: toMessage(err) })),
          ),
        ),
      ),
    ),
  );
}

function toMessage(err: unknown): string {
  if (err instanceof CryptoError) return err.message;
  if (err instanceof Error) return err.message;
  return 'Unknown error';
}

/**
 * Floating-point arithmetic can leave residue like 0.30000000000000004 after
 * a withdrawal; rounding to a generous 12 decimals keeps the stored balance
 * clean without truncating legitimately tiny amounts.
 */
function roundAmount(value: number): number {
  const factor = 1e12;
  return Math.round(value * factor) / factor;
}

function newId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `id-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}
