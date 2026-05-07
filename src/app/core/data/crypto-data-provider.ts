import { InjectionToken } from '@angular/core';
import { Observable } from 'rxjs';

import { Coin, HistoricalPoint, MarketRow, Quote, Range } from '../domain';
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
