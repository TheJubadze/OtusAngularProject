import { Injectable, inject } from '@angular/core';
import {
  BehaviorSubject,
  Observable,
  catchError,
  combineLatest,
  debounceTime,
  distinctUntilChanged,
  map,
  of,
  scan,
  shareReplay,
  startWith,
  switchMap,
  tap,
} from 'rxjs';

import {
  CRYPTO_PROVIDER,
  MarketSortField,
  MarketsQuery,
  SortDirection,
} from '../../core/data';
import {
  CryptoError,
  HistoricalPoint,
  MarketRow,
  Quote,
  Range,
} from '../../core/domain';

export interface WatchlistRow extends MarketRow {
  readonly history?: readonly HistoricalPoint[];
}

const HISTORY_RANGE: Range = '7d';

@Injectable()
export class WatchlistState {
  private readonly provider = inject(CRYPTO_PROVIDER);

  private readonly searchSubject = new BehaviorSubject<string>('');
  private readonly vsCurrencySubject = new BehaviorSubject<string>('usd');
  private readonly sortBySubject = new BehaviorSubject<MarketSortField>('marketCap');
  private readonly sortDirSubject = new BehaviorSubject<SortDirection>('desc');

  private readonly loadingSubject = new BehaviorSubject<boolean>(false);
  private readonly errorSubject = new BehaviorSubject<string | null>(null);

  readonly search$ = this.searchSubject.asObservable();
  readonly vsCurrency$ = this.vsCurrencySubject.asObservable();
  readonly sortBy$ = this.sortBySubject.asObservable();
  readonly sortDir$ = this.sortDirSubject.asObservable();
  readonly loading$ = this.loadingSubject.asObservable();
  readonly error$ = this.errorSubject.asObservable();

  readonly supportedCurrencies$ = this.provider
    .getSupportedVsCurrencies()
    .pipe(shareReplay({ bufferSize: 1, refCount: true }));

  private readonly fetchQuery$: Observable<MarketsQuery> = combineLatest([
    this.search$.pipe(
      debounceTime(200),
      map((s) => s.trim()),
      distinctUntilChanged(),
    ),
    this.vsCurrency$.pipe(distinctUntilChanged()),
  ]).pipe(map(([search, vsCurrency]) => ({ vsCurrency, search })));

  /**
   * One getMarkets fetch shared by both the live-quote and history pipelines.
   */
  private readonly initialFetch$ = this.fetchQuery$.pipe(
    tap(() => {
      this.loadingSubject.next(true);
      this.errorSubject.next(null);
    }),
    switchMap((query) =>
      this.provider.getMarkets(query).pipe(
        tap(() => this.loadingSubject.next(false)),
        map((rows) => ({ query, rows })),
        catchError((err) => {
          this.loadingSubject.next(false);
          this.errorSubject.next(toMessage(err));
          return of({ query, rows: [] as MarketRow[] });
        }),
      ),
    ),
    shareReplay({ bufferSize: 1, refCount: true }),
  );

  private readonly rowsWithLive$: Observable<MarketRow[]> = this.initialFetch$.pipe(
    switchMap(({ rows, query }) => {
      const ids = rows.map((r) => r.id);
      if (ids.length === 0) return of(rows);
      return this.provider.liveQuotes(ids, query.vsCurrency).pipe(
        scan((acc, q) => applyQuote(acc, q), rows),
        startWith(rows),
      );
    }),
  );

  /**
   * Per-coin history map keyed by coin id. Refetched only when the query changes.
   * Emits an empty map first so rows can render before sparklines are ready.
   */
  private readonly histories$: Observable<ReadonlyMap<string, readonly HistoricalPoint[]>> =
    this.initialFetch$.pipe(
      switchMap(({ rows, query }) => {
        if (rows.length === 0) {
          return of(new Map<string, readonly HistoricalPoint[]>());
        }
        const requests = rows.map((r) =>
          this.provider.getHistory(r.id, query.vsCurrency, HISTORY_RANGE).pipe(
            map((points) => [r.id, points] as const),
            catchError(() => of([r.id, [] as readonly HistoricalPoint[]] as const)),
          ),
        );
        return combineLatest(requests).pipe(
          map((pairs) => new Map(pairs)),
          startWith(new Map<string, readonly HistoricalPoint[]>()),
        );
      }),
    );

  readonly rows$: Observable<WatchlistRow[]> = combineLatest([
    this.rowsWithLive$,
    this.histories$,
    this.sortBy$,
    this.sortDir$,
  ]).pipe(
    map(([rows, histories, by, dir]) => {
      const enriched: WatchlistRow[] = rows.map((r) => ({
        ...r,
        history: histories.get(r.id),
      }));
      return sortRows(enriched, by, dir);
    }),
  );

  setSearch(value: string): void {
    this.searchSubject.next(value);
  }

  setVsCurrency(value: string): void {
    this.vsCurrencySubject.next(value.toLowerCase());
  }

  toggleSort(field: MarketSortField): void {
    if (this.sortBySubject.value === field) {
      this.sortDirSubject.next(this.sortDirSubject.value === 'asc' ? 'desc' : 'asc');
    } else {
      this.sortBySubject.next(field);
      this.sortDirSubject.next(field === 'name' ? 'asc' : 'desc');
    }
  }
}

function applyQuote(rows: readonly MarketRow[], quote: Quote): MarketRow[] {
  let changed = false;
  const next = rows.map((row) => {
    if (row.id !== quote.coinId || row.vsCurrency !== quote.vsCurrency) {
      return row;
    }
    changed = true;
    return {
      ...row,
      price: quote.price,
      marketCap: quote.marketCap,
      circulatingSupply: quote.circulatingSupply ?? row.circulatingSupply,
      change24hPct: quote.change24hPct,
      updatedAt: quote.updatedAt,
    };
  });
  return changed ? next : (rows as MarketRow[]);
}

function sortRows<T extends MarketRow>(
  rows: readonly T[],
  field: MarketSortField,
  dir: SortDirection,
): T[] {
  const mul = dir === 'asc' ? 1 : -1;
  const copy = rows.slice();
  copy.sort((a, b) => {
    const av = pick(a, field);
    const bv = pick(b, field);
    if (av === bv) return 0;
    if (av === undefined) return 1;
    if (bv === undefined) return -1;
    return av < bv ? -1 * mul : 1 * mul;
  });
  return copy;
}

function pick(row: MarketRow, field: MarketSortField): number | string | undefined {
  switch (field) {
    case 'marketCap': return row.marketCap;
    case 'price': return row.price;
    case 'change24hPct': return row.change24hPct;
    case 'name': return row.name.toLowerCase();
  }
}

function toMessage(err: unknown): string {
  if (err instanceof CryptoError) return err.message;
  if (err instanceof Error) return err.message;
  return 'Unknown error';
}
