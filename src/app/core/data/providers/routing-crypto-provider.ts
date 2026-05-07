import { Injectable, inject } from '@angular/core';
import { Observable, defer } from 'rxjs';

import { Coin, HistoricalPoint, MarketRow, Quote, Range } from '../../domain';
import { CryptoDataProvider } from '../crypto-data-provider';
import { MarketsQuery } from '../markets-query';
import { CryptoProviderRegistry } from '../provider-registry';

/**
 * Thin delegator that captures a snapshot of the active provider at
 * subscribe time and forwards the call. It does NOT auto-switch mid-stream
 * when the active provider changes — the consumer is responsible for
 * restarting subscriptions (typically by including registry.activeName$
 * in their own trigger pipeline). This avoids carrying provider-specific
 * arguments (e.g. coin ids) across providers, which would form invalid
 * requests.
 */
@Injectable()
export class RoutingCryptoProvider implements CryptoDataProvider {
  private readonly registry = inject(CryptoProviderRegistry);

  getMarkets(query: MarketsQuery): Observable<MarketRow[]> {
    return defer(() => this.registry.active.getMarkets(query));
  }

  getQuote(coinId: string, vsCurrency: string): Observable<Quote> {
    return defer(() => this.registry.active.getQuote(coinId, vsCurrency));
  }

  getHistory(
    coinId: string,
    vsCurrency: string,
    range: Range,
  ): Observable<HistoricalPoint[]> {
    return defer(() =>
      this.registry.active.getHistory(coinId, vsCurrency, range),
    );
  }

  searchCoins(query: string): Observable<Coin[]> {
    return defer(() => this.registry.active.searchCoins(query));
  }

  liveQuotes(
    coinIds: readonly string[],
    vsCurrency: string,
  ): Observable<Quote> {
    return defer(() => this.registry.active.liveQuotes(coinIds, vsCurrency));
  }

  getSupportedVsCurrencies(): Observable<readonly string[]> {
    return defer(() => this.registry.active.getSupportedVsCurrencies());
  }
}
