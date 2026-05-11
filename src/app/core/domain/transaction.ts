export type TransactionKind = 'deposit' | 'send';

/**
 * An entry in the wallet's append-only log: each deposit/send is recorded
 * here at the moment it succeeds against the fake backend. `amount` is
 * always positive — `kind` carries the direction. `note` holds free text
 * (address for sends, source for deposits).
 */
export interface Transaction {
  readonly id: string;
  readonly coinId: string;
  readonly symbol: string;
  readonly kind: TransactionKind;
  readonly amount: number;
  readonly note?: string;
  readonly createdAt: string;
}
