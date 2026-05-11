/**
 * A position in the user's wallet: how much of a given coin they hold.
 * `coinId`/`symbol`/`name` are denormalized so the wallet UI can render
 * even when the active crypto provider doesn't know about this coin
 * (e.g. user deposited via CoinGecko, then switched to Binance whose
 * coin universe uses different ids). Price lookups against the active
 * provider may then return undefined, and the UI shows "—" for value.
 */
export interface Holding {
  readonly id: string;
  readonly coinId: string;
  readonly symbol: string;
  readonly name: string;
  readonly amount: number;
  readonly updatedAt: string;
}
