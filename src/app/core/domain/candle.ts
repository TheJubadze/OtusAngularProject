/**
 * One OHLC candle (with optional volume) for a single time bucket.
 * The bucket size depends on the requested Range and the provider —
 * Binance and CoinGecko pick different granularities for the same Range.
 */
export interface Candle {
  readonly timestamp: number;
  readonly open: number;
  readonly high: number;
  readonly low: number;
  readonly close: number;
  readonly volume?: number;
}
