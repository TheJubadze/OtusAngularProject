import { InjectionToken } from '@angular/core';
import { Observable } from 'rxjs';

import {
  Candle,
  Coin,
  HistoricalPoint,
  MarketRow,
  Quote,
  Range,
} from '../domain';
import { MarketsQuery } from './markets-query';

/**
 * Source-agnostic interface for crypto market data.
 * Implementations (mock, CoinGecko, Binance, ...) translate their DTOs
 * into our domain models so the UI never sees provider specifics.
 */
export interface CryptoDataProvider {
  getMarkets(query: MarketsQuery): Observable<MarketRow[]>;

  getQuote(coinId: string, vsCurrency: string): Observable<Quote>;

  getHistory(
    coinId: string,
    vsCurrency: string,
    range: Range,
  ): Observable<HistoricalPoint[]>;

  /**
   * OHLC candles for the given range. Granularity is chosen by the provider
   * based on the range (e.g. 1m candles for 1h range, 1h candles for 7d).
   */
  getCandles(
    coinId: string,
    vsCurrency: string,
    range: Range,
  ): Observable<Candle[]>;

  /**
   * Continuous stream of candle updates for a single coin at the granularity
   * implied by the range. Each emission is the current state of either the
   * "in-progress" candle (high/low/close evolving) or, when a bucket closes,
   * a freshly-opened candle. Implementations: Binance uses native kline
   * WebSocket; Mock synthesizes via interval; CoinGecko returns EMPTY (no
   * native stream and polling at sub-day granularity is impractical).
   */
  liveCandles(
    coinId: string,
    vsCurrency: string,
    range: Range,
  ): Observable<Candle>;

  searchCoins(query: string): Observable<Coin[]>;

  /**
   * A continuous stream of quote updates for the requested coins.
   * REST-only providers may implement this via polling; streaming providers
   * use their native channel. The UI does not care which.
   */
  liveQuotes(coinIds: readonly string[], vsCurrency: string): Observable<Quote>;

  getSupportedVsCurrencies(): Observable<readonly string[]>;
}

export const CRYPTO_PROVIDER = new InjectionToken<CryptoDataProvider>(
  'CRYPTO_PROVIDER',
);
