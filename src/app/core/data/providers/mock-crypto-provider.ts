import { Injectable } from '@angular/core';
import {
  Observable,
  concat,
  defer,
  delay,
  from,
  map,
  of,
  switchMap,
  throwError,
  timer,
} from 'rxjs';

import {
  Coin,
  CryptoError,
  HistoricalPoint,
  MarketRow,
  Quote,
  Range,
  toMarketRow,
} from '../../domain';
import { CryptoDataProvider } from '../crypto-data-provider';
import {
  MarketSortField,
  MarketsQuery,
  SortDirection,
} from '../markets-query';

interface MockCoinSeed extends Coin {
  readonly basePriceUsd: number;
  readonly circulatingSupply: number;
  readonly volatility: number;
}

const SEEDS: readonly MockCoinSeed[] = [
  { id: 'bitcoin', symbol: 'BTC', name: 'Bitcoin', basePriceUsd: 67_000, circulatingSupply: 19_700_000, volatility: 0.015 },
  { id: 'ethereum', symbol: 'ETH', name: 'Ethereum', basePriceUsd: 3_500, circulatingSupply: 120_400_000, volatility: 0.02 },
  { id: 'tether', symbol: 'USDT', name: 'Tether', basePriceUsd: 1, circulatingSupply: 110_000_000_000, volatility: 0.0005 },
  { id: 'solana', symbol: 'SOL', name: 'Solana', basePriceUsd: 165, circulatingSupply: 467_000_000, volatility: 0.04 },
  { id: 'bnb', symbol: 'BNB', name: 'BNB', basePriceUsd: 580, circulatingSupply: 147_000_000, volatility: 0.025 },
  { id: 'ripple', symbol: 'XRP', name: 'XRP', basePriceUsd: 0.62, circulatingSupply: 56_000_000_000, volatility: 0.03 },
  { id: 'cardano', symbol: 'ADA', name: 'Cardano', basePriceUsd: 0.45, circulatingSupply: 35_500_000_000, volatility: 0.035 },
  { id: 'dogecoin', symbol: 'DOGE', name: 'Dogecoin', basePriceUsd: 0.13, circulatingSupply: 144_000_000_000, volatility: 0.05 },
];

const FX_VS_USD: Record<string, number> = {
  usd: 1,
  eur: 0.92,
  rub: 92,
  btc: 1 / 67_000,
};

const SUPPORTED = Object.keys(FX_VS_USD);

@Injectable({ providedIn: 'root' })
export class MockCryptoProvider implements CryptoDataProvider {
  getMarkets(query: MarketsQuery): Observable<MarketRow[]> {
    return defer(() => {
      const vs = query.vsCurrency.toLowerCase();
      if (!(vs in FX_VS_USD)) {
        return throwError(
          () => new CryptoError('unsupported', `Currency ${vs} is not supported`),
        );
      }
      const search = (query.search ?? '').trim().toLowerCase();
      const filtered = SEEDS.filter(
        (c) =>
          !search ||
          c.name.toLowerCase().includes(search) ||
          c.symbol.toLowerCase().includes(search),
      );
      const rows = filtered.map((seed) =>
        toMarketRow(seedToCoin(seed), buildQuote(seed, vs)),
      );
      sortRows(rows, query.sortBy ?? 'marketCap', query.sortDir ?? 'desc');
      const page = query.page ?? 1;
      const pageSize = query.pageSize ?? rows.length;
      const start = (page - 1) * pageSize;
      return of(rows.slice(start, start + pageSize));
    }).pipe(delay(150));
  }

  getQuote(coinId: string, vsCurrency: string): Observable<Quote> {
    return defer(() => {
      const seed = SEEDS.find((c) => c.id === coinId);
      if (!seed) {
        return throwError(() => new CryptoError('not-found', `Coin ${coinId} not found`));
      }
      const vs = vsCurrency.toLowerCase();
      if (!(vs in FX_VS_USD)) {
        return throwError(
          () => new CryptoError('unsupported', `Currency ${vs} is not supported`),
        );
      }
      return of(buildQuote(seed, vs));
    }).pipe(delay(100));
  }

  getHistory(
    coinId: string,
    vsCurrency: string,
    range: Range,
  ): Observable<HistoricalPoint[]> {
    return defer(() => {
      const seed = SEEDS.find((c) => c.id === coinId);
      if (!seed) {
        return throwError(() => new CryptoError('not-found', `Coin ${coinId} not found`));
      }
      const vs = vsCurrency.toLowerCase();
      if (!(vs in FX_VS_USD)) {
        return throwError(
          () => new CryptoError('unsupported', `Currency ${vs} is not supported`),
        );
      }
      return of(buildHistory(seed, vs, range));
    }).pipe(delay(200));
  }

  searchCoins(query: string): Observable<Coin[]> {
    const q = query.trim().toLowerCase();
    const matches = q
      ? SEEDS.filter(
          (c) =>
            c.name.toLowerCase().includes(q) || c.symbol.toLowerCase().includes(q),
        )
      : SEEDS.slice();
    return of(matches.map(seedToCoin)).pipe(delay(80));
  }

  liveQuotes(
    coinIds: readonly string[],
    vsCurrency: string,
  ): Observable<Quote> {
    const vs = vsCurrency.toLowerCase();
    const seeds = SEEDS.filter((s) => coinIds.includes(s.id));
    if (seeds.length === 0) {
      return concat(of<Quote>(), timer(0)).pipe(switchMap(() => of<Quote>()));
    }
    return timer(0, 2000).pipe(
      switchMap(() => from(seeds.map((seed) => buildQuote(seed, vs)))),
    );
  }

  getSupportedVsCurrencies(): Observable<readonly string[]> {
    return of(SUPPORTED).pipe(delay(50));
  }
}

function seedToCoin(seed: MockCoinSeed): Coin {
  return { id: seed.id, symbol: seed.symbol, name: seed.name };
}

function buildQuote(seed: MockCoinSeed, vsCurrency: string): Quote {
  const fx = FX_VS_USD[vsCurrency];
  const jitter = (Math.random() - 0.5) * 2 * seed.volatility;
  const priceUsd = seed.basePriceUsd * (1 + jitter);
  const marketCapUsd = priceUsd * seed.circulatingSupply;
  return {
    coinId: seed.id,
    vsCurrency,
    price: priceUsd * fx,
    marketCap: marketCapUsd * fx,
    circulatingSupply: seed.circulatingSupply,
    change24hPct: jitter * 100,
    updatedAt: new Date(),
  };
}

function buildHistory(
  seed: MockCoinSeed,
  vsCurrency: string,
  range: Range,
): HistoricalPoint[] {
  const fx = FX_VS_USD[vsCurrency];
  const points = pointCount(range);
  const stepMs = rangeMs(range) / points;
  const now = Date.now();
  const out: HistoricalPoint[] = [];
  let price = seed.basePriceUsd;
  for (let i = points - 1; i >= 0; i--) {
    const drift = (Math.random() - 0.5) * 2 * seed.volatility;
    price = price * (1 + drift);
    out.push({ timestamp: now - i * stepMs, price: price * fx });
  }
  return out;
}

function pointCount(range: Range): number {
  switch (range) {
    case '1d': return 24;
    case '7d': return 24 * 7;
    case '30d': return 30;
    case '90d': return 90;
    case '1y': return 52;
    case 'max': return 100;
  }
}

function rangeMs(range: Range): number {
  const day = 24 * 60 * 60 * 1000;
  switch (range) {
    case '1d': return day;
    case '7d': return 7 * day;
    case '30d': return 30 * day;
    case '90d': return 90 * day;
    case '1y': return 365 * day;
    case 'max': return 5 * 365 * day;
  }
}

function sortRows(
  rows: MarketRow[],
  field: MarketSortField,
  dir: SortDirection,
): void {
  const mul = dir === 'asc' ? 1 : -1;
  rows.sort((a, b) => {
    const av = sortValue(a, field);
    const bv = sortValue(b, field);
    if (av === bv) return 0;
    if (av === undefined) return 1;
    if (bv === undefined) return -1;
    return av < bv ? -1 * mul : 1 * mul;
  });
}

function sortValue(row: MarketRow, field: MarketSortField): number | string | undefined {
  switch (field) {
    case 'marketCap': return row.marketCap;
    case 'price': return row.price;
    case 'change24hPct': return row.change24hPct;
    case 'name': return row.name.toLowerCase();
  }
}
