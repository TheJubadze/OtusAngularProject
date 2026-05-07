import {
  HttpClient,
  HttpErrorResponse,
  HttpParams,
} from '@angular/common/http';
import { InjectionToken, Injectable, inject } from '@angular/core';
import {
  EMPTY,
  Observable,
  catchError,
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
} from '../../domain';
import { CryptoDataProvider } from '../crypto-data-provider';
import {
  MarketSortField,
  MarketsQuery,
  SortDirection,
} from '../markets-query';

/**
 * Optional CoinGecko demo-plan API key. When provided, every request gets
 * `x_cg_demo_api_key=<key>` appended as a query parameter — this raises the
 * rate limit to ~30 req/min without triggering a CORS preflight (which a
 * custom header would, and which CoinGecko 429s aggressively on the free
 * tier). Get a free key at https://www.coingecko.com/en/api/pricing.
 *
 * Provide it in app.config.ts:
 *   { provide: COINGECKO_API_KEY, useValue: 'CG-xxxxxxxxxxxxxxxx' }
 */
export const COINGECKO_API_KEY = new InjectionToken<string>(
  'COINGECKO_API_KEY',
);

/**
 * REST adapter for CoinGecko v3 (https://api.coingecko.com/api/v3).
 * The free public tier requires no auth but is heavily rate-limited
 * (~10-15 req/min). Adding a demo API key raises that to ~30 req/min.
 *
 * Mapping notes:
 * - getMarkets sorts server-side only by market_cap (the only sortBy
 *   CoinGecko's /coins/markets supports natively); other fields are sorted
 *   client-side by WatchlistState. Search is also client-side over the
 *   returned page. sparkline=true inlines 7d hourly prices on each row.
 * - liveQuotes polls /simple/price every 60s — CoinGecko has no streaming.
 *   Failed ticks (429, network) are swallowed inside the inner switchMap so
 *   the timer keeps ticking; one bad tick won't kill the whole stream.
 * - 429 responses are surfaced as CryptoError('rate-limited') with the
 *   server's Retry-After value.
 */
@Injectable({ providedIn: 'root' })
export class CoinGeckoCryptoProvider implements CryptoDataProvider {
  private readonly http = inject(HttpClient);
  private readonly apiKey = inject(COINGECKO_API_KEY, { optional: true });
  private readonly base = 'https://api.coingecko.com/api/v3';

  /**
   * Live polling cadence. With a demo API key the limit is ~30 req/min, so
   * 10s (6/min) is comfortable. Without a key the public tier is ~10-15/min,
   * so we drop to 60s (1/min) to leave room for the initial fetch.
   */
  private readonly pollIntervalMs = this.apiKey ? 10_000 : 60_000;

  /**
   * Decorates request params with the API key (when configured) and a
   * cache-busting timestamp. The timestamp is essential for the polling
   * endpoint: identical URLs would otherwise be served from disk cache and
   * the displayed prices would never change. The key is sent as a query
   * param (not a header) to avoid triggering a CORS preflight.
   */
  private decorate(params: HttpParams = new HttpParams()): HttpParams {
    let p = params.set('_t', String(Date.now()));
    if (this.apiKey) p = p.set('x_cg_demo_api_key', this.apiKey);
    return p;
  }

  getMarkets(query: MarketsQuery): Observable<MarketRow[]> {
    const params = this.decorate(
      new HttpParams()
        .set('vs_currency', query.vsCurrency)
        .set('order', toCoinGeckoOrder(query.sortBy, query.sortDir))
        .set('per_page', String(query.pageSize ?? 50))
        .set('page', String(query.page ?? 1))
        // sparkline=true asks CoinGecko to inline 7d hourly prices on each row.
        // This collapses N+1 history calls into one and is essential for
        // staying within the free-tier rate limit.
        .set('sparkline', 'true')
        .set('price_change_percentage', '24h'),
    );

    return this.http
      .get<CoinGeckoMarketDto[]>(`${this.base}/coins/markets`, { params })
      .pipe(
        map((dtos) =>
          dtos.map((dto) => toMarketRow(dto, query.vsCurrency.toLowerCase())),
        ),
        map((rows) => filterBySearch(rows, query.search)),
        catchError((err) => throwError(() => mapHttpError(err))),
      );
  }

  getQuote(coinId: string, vsCurrency: string): Observable<Quote> {
    return this.fetchSimplePrice([coinId], vsCurrency).pipe(
      map((quotes) => {
        if (quotes.length === 0) {
          throw new CryptoError('not-found', `Coin ${coinId} not found`);
        }
        return quotes[0];
      }),
    );
  }

  getHistory(
    coinId: string,
    vsCurrency: string,
    range: Range,
  ): Observable<HistoricalPoint[]> {
    const params = this.decorate(
      new HttpParams()
        .set('vs_currency', vsCurrency)
        .set('days', toDays(range)),
    );
    return this.http
      .get<CoinGeckoMarketChartDto>(
        `${this.base}/coins/${encodeURIComponent(coinId)}/market_chart`,
        { params },
      )
      .pipe(
        map((dto) =>
          dto.prices.map(([timestamp, price]) => ({ timestamp, price })),
        ),
        catchError((err) => throwError(() => mapHttpError(err))),
      );
  }

  searchCoins(query: string): Observable<Coin[]> {
    const q = query.trim();
    if (!q) {
      return this.http
        .get<CoinGeckoMarketDto[]>(`${this.base}/coins/markets`, {
          params: this.decorate(
            new HttpParams()
              .set('vs_currency', 'usd')
              .set('per_page', '50')
              .set('page', '1'),
          ),
        })
        .pipe(
          map((dtos) => dtos.map(toCoin)),
          catchError((err) => throwError(() => mapHttpError(err))),
        );
    }
    return this.http
      .get<CoinGeckoSearchDto>(`${this.base}/search`, {
        params: this.decorate(new HttpParams().set('query', q)),
      })
      .pipe(
        map((dto) =>
          dto.coins.map<Coin>((c) => ({
            id: c.id,
            symbol: c.symbol.toUpperCase(),
            name: c.name,
            imageUrl: c.large,
          })),
        ),
        catchError((err) => throwError(() => mapHttpError(err))),
      );
  }

  liveQuotes(
    coinIds: readonly string[],
    vsCurrency: string,
  ): Observable<Quote> {
    if (coinIds.length === 0) return EMPTY;
    return timer(0, this.pollIntervalMs).pipe(
      // catchError lives INSIDE switchMap so a single failed tick (429,
      // network blip) doesn't terminate the whole polling stream.
      switchMap(() =>
        this.fetchSimplePrice(coinIds, vsCurrency).pipe(
          catchError((err) => {
            // eslint-disable-next-line no-console
            console.warn('[CoinGecko] liveQuotes tick failed:', err);
            return of<Quote[]>([]);
          }),
        ),
      ),
      switchMap((quotes) => from(quotes)),
    );
  }

  getSupportedVsCurrencies(): Observable<readonly string[]> {
    return this.http
      .get<readonly string[]>(`${this.base}/simple/supported_vs_currencies`, {
        params: this.decorate(),
      })
      .pipe(catchError((err) => throwError(() => mapHttpError(err))));
  }

  private fetchSimplePrice(
    coinIds: readonly string[],
    vsCurrency: string,
  ): Observable<Quote[]> {
    const vs = vsCurrency.toLowerCase();
    const params = this.decorate(
      new HttpParams()
        .set('ids', coinIds.join(','))
        .set('vs_currencies', vs)
        .set('include_market_cap', 'true')
        .set('include_24hr_change', 'true')
        .set('include_last_updated_at', 'true'),
    );

    return this.http
      .get<CoinGeckoSimplePriceDto>(`${this.base}/simple/price`, {
        params,
      })
      .pipe(
        map((dto) => simplePriceToQuotes(dto, vs)),
        catchError((err) => throwError(() => mapHttpError(err))),
      );
  }
}

interface CoinGeckoMarketDto {
  id: string;
  symbol: string;
  name: string;
  image: string;
  current_price: number;
  market_cap: number | null;
  circulating_supply: number | null;
  price_change_percentage_24h: number | null;
  last_updated: string;
  sparkline_in_7d?: { price: number[] };
}

interface CoinGeckoMarketChartDto {
  prices: Array<[number, number]>;
}

interface CoinGeckoSearchDto {
  coins: Array<{
    id: string;
    name: string;
    symbol: string;
    large: string;
  }>;
}

type CoinGeckoSimplePriceDto = Record<
  string,
  Record<string, number | undefined>
>;

function toMarketRow(dto: CoinGeckoMarketDto, vsCurrency: string): MarketRow {
  return {
    id: dto.id,
    symbol: dto.symbol.toUpperCase(),
    name: dto.name,
    imageUrl: dto.image,
    vsCurrency,
    price: dto.current_price,
    marketCap: dto.market_cap ?? undefined,
    circulatingSupply: dto.circulating_supply ?? undefined,
    change24hPct: dto.price_change_percentage_24h ?? undefined,
    updatedAt: new Date(dto.last_updated),
    history: sparklineToPoints(dto.sparkline_in_7d?.price),
  };
}

/**
 * CoinGecko's sparkline_in_7d.price is a flat array of hourly prices over
 * the last 7 days. Synthesize timestamps assuming 1-hour spacing ending now.
 */
function sparklineToPoints(
  prices: readonly number[] | undefined,
): readonly HistoricalPoint[] | undefined {
  if (!prices || prices.length === 0) return undefined;
  const now = Date.now();
  const stepMs = 60 * 60 * 1000;
  const last = prices.length - 1;
  return prices.map((price, i) => ({
    timestamp: now - (last - i) * stepMs,
    price,
  }));
}

function toCoin(dto: CoinGeckoMarketDto): Coin {
  return {
    id: dto.id,
    symbol: dto.symbol.toUpperCase(),
    name: dto.name,
    imageUrl: dto.image,
  };
}

function simplePriceToQuotes(
  dto: CoinGeckoSimplePriceDto,
  vsCurrency: string,
): Quote[] {
  const out: Quote[] = [];
  for (const [coinId, fields] of Object.entries(dto)) {
    const price = fields[vsCurrency];
    if (price === undefined) continue;
    out.push({
      coinId,
      vsCurrency,
      price,
      marketCap: fields[`${vsCurrency}_market_cap`],
      change24hPct: fields[`${vsCurrency}_24h_change`],
      updatedAt: fields['last_updated_at']
        ? new Date(fields['last_updated_at']! * 1000)
        : new Date(),
    });
  }
  return out;
}

function toCoinGeckoOrder(
  sortBy: MarketSortField | undefined,
  sortDir: SortDirection | undefined,
): string {
  // CoinGecko only supports server-side sort by market_cap, volume, or id.
  // Anything else falls back to market_cap_desc; client re-sorts if needed.
  if (sortBy === 'marketCap') {
    return sortDir === 'asc' ? 'market_cap_asc' : 'market_cap_desc';
  }
  return 'market_cap_desc';
}

function filterBySearch(
  rows: readonly MarketRow[],
  search: string | undefined,
): MarketRow[] {
  const q = (search ?? '').trim().toLowerCase();
  if (!q) return rows.slice();
  return rows.filter(
    (r) =>
      r.name.toLowerCase().includes(q) || r.symbol.toLowerCase().includes(q),
  );
}

function toDays(range: Range): string {
  switch (range) {
    case '1d': return '1';
    case '7d': return '7';
    case '30d': return '30';
    case '90d': return '90';
    case '1y': return '365';
    case 'max': return 'max';
  }
}

function mapHttpError(err: unknown): CryptoError {
  if (!(err instanceof HttpErrorResponse)) {
    return new CryptoError('unknown', 'Unexpected error', undefined, err);
  }
  if (err.status === 429) {
    const retryHeader = err.headers.get('retry-after');
    const retryAfterMs = retryHeader ? Number(retryHeader) * 1000 : undefined;
    return new CryptoError(
      'rate-limited',
      'CoinGecko rate limit exceeded',
      retryAfterMs,
      err,
    );
  }
  if (err.status === 404) {
    return new CryptoError('not-found', 'Resource not found', undefined, err);
  }
  if (err.status === 0) {
    return new CryptoError('network', 'Network error', undefined, err);
  }
  return new CryptoError(
    'unknown',
    `CoinGecko ${err.status}: ${err.statusText}`,
    undefined,
    err,
  );
}
