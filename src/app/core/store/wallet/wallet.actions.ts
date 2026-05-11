import { createActionGroup, emptyProps, props } from '@ngrx/store';

import { Holding, Transaction } from '../../domain';

/**
 * Wallet feature actions. Mutations (deposit/send) are intentionally
 * collapsed into a single `Mutation Success`/`Mutation Failure` pair —
 * both flows produce the same shape (one Holding upsert + one Transaction
 * append), so the reducer can handle either in one place. `removed: true`
 * tells the reducer the holding was fully drained and should be dropped.
 */
export const WalletActions = createActionGroup({
  source: 'Wallet',
  events: {
    'Load Holdings': emptyProps(),
    'Load Holdings Success': props<{ holdings: readonly Holding[] }>(),
    'Load Holdings Failure': props<{ error: string }>(),

    'Load Transactions': emptyProps(),
    'Load Transactions Success': props<{ transactions: readonly Transaction[] }>(),
    'Load Transactions Failure': props<{ error: string }>(),

    Deposit: props<{
      coinId: string;
      symbol: string;
      name: string;
      amount: number;
      note?: string;
    }>(),
    Send: props<{
      coinId: string;
      symbol: string;
      name: string;
      amount: number;
      note?: string;
    }>(),

    'Mutation Success': props<{
      holding: Holding;
      transaction: Transaction;
      removed?: boolean;
    }>(),
    'Mutation Failure': props<{ error: string }>(),

    'Set Selected Coin': props<{ coinId: string | null }>(),
    'Set Search': props<{ search: string }>(),
    'Clear Error': emptyProps(),
  },
});
