import { Injectable, inject } from '@angular/core';
import { Store } from '@ngrx/store';
import {
  EMPTY,
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
} from 'rxjs';

import {
  CRYPTO_PROVIDER,
  CryptoProviderRegistry,
} from '../../core/data';
import { Holding, MarketRow, Quote, Transaction } from '../../core/domain';
import { PrefsActions, prefsFeature } from '../../core/store/prefs';
import { WalletActions, walletFeature } from '../../core/store/wallet';

export interface WalletRow extends Holding {
  readonly price?: number;
  readonly value?: number;
}

export interface PortfolioTotal {
  readonly value: number;
  /** False when any held coin's price could not be resolved by the active
   *  provider — UI signals this with a "≈" prefix and a tooltip. */
  readonly complete: boolean;
}

@Injectable()
export class WalletState {
  private readonly provider = inject(CRYPTO_PROVIDER);
  private readonly registry = inject(CryptoProviderRegistry);
  private readonly store = inject(Store);

  readonly holdings$ = this.store.select(walletFeature.selectHoldings);
  readonly transactions$ = this.store.select(walletFeature.selectTransactions);
  readonly loadingHoldings$ = this.store.select(
    walletFeature.selectLoadingHoldings,
  );
  readonly loadingTransactions$ = this.store.select(
    walletFeature.selectLoadingTransactions,
  );
  readonly mutating$ = this.store.select(walletFeature.selectMutating);
  readonly error$ = this.store.select(walletFeature.selectError);
  readonly selectedCoinId$ = this.store.select(
    walletFeature.selectSelectedCoinId,
  );
  readonly search$ = this.store.select(walletFeature.selectSearch);
  readonly vsCurrency$ = this.store.select(prefsFeature.selectVsCurrency);

  readonly supportedCurrencies$ = this.provider
    .getSupportedVsCurrencies()
    .pipe(shareReplay({ bufferSize: 1, refCount: true }));

  /**
   * Coin list used by the deposit picker. Refetched on provider/currency
   * change. Failures swallowed silently so a backend outage doesn't break
   * the wallet screen — user can still see existing holdings.
   */
  readonly availableCoins$: Observable<readonly MarketRow[]> = combineLatest([
    this.registry.activeName$.pipe(distinctUntilChanged()),
    this.vsCurrency$.pipe(distinctUntilChanged()),
  ]).pipe(
    switchMap(([, vsCurrency]) =>
      this.provider.getMarkets({ vsCurrency, page: 1, pageSize: 100 }).pipe(
        catchError(() => of([] as MarketRow[])),
      ),
    ),
    shareReplay({ bufferSize: 1, refCount: true }),
  );

  /**
   * Live prices for held coins keyed by coinId. The trigger key is the
   * sorted comma-joined coinId list so that adding/removing a holding
   * restarts the subscription, but irrelevant store changes (search,
   * selection) do not. Seeded empty; `scan` fills in prices as ticks
   * arrive. Quotes for non-current vsCurrency are ignored — guards
   * against late ticks racing a currency switch.
   */
  private readonly prices$: Observable<ReadonlyMap<string, number>> =
    combineLatest([
      this.holdings$.pipe(
        map((hs) =>
          hs
            .map((h) => h.coinId)
            .slice()
            .sort()
            .join(','),
        ),
        distinctUntilChanged(),
      ),
      this.vsCurrency$.pipe(distinctUntilChanged()),
      this.registry.activeName$.pipe(distinctUntilChanged()),
    ]).pipe(
      switchMap(([idsKey, vsCurrency]) => {
        const empty: ReadonlyMap<string, number> = new Map();
        if (!idsKey) return of(empty);
        const ids = idsKey.split(',');
        return this.provider.liveQuotes(ids, vsCurrency).pipe(
          catchError(() => EMPTY),
          scan((acc: ReadonlyMap<string, number>, q: Quote) => {
            if (q.vsCurrency !== vsCurrency) return acc;
            const next = new Map(acc);
            next.set(q.coinId, q.price);
            return next;
          }, empty),
          startWith(empty),
        );
      }),
      shareReplay({ bufferSize: 1, refCount: true }),
    );

  /** Holdings enriched with live price and value, filtered by search. */
  readonly rows$: Observable<readonly WalletRow[]> = combineLatest([
    this.holdings$,
    this.prices$,
    this.search$.pipe(debounceTime(100), distinctUntilChanged()),
  ]).pipe(
    map(([holdings, prices, search]) => {
      const q = search.trim().toLowerCase();
      const matched = q
        ? holdings.filter(
            (h) =>
              h.name.toLowerCase().includes(q) ||
              h.symbol.toLowerCase().includes(q),
          )
        : holdings;
      return matched
        .map((h): WalletRow => {
          const price = prices.get(h.coinId);
          return {
            ...h,
            price,
            value: price != null ? price * h.amount : undefined,
          };
        })
        .sort((a, b) => (b.value ?? 0) - (a.value ?? 0));
    }),
    shareReplay({ bufferSize: 1, refCount: true }),
  );

  readonly total$: Observable<PortfolioTotal> = combineLatest([
    this.holdings$,
    this.prices$,
  ]).pipe(
    map(([holdings, prices]) => {
      let value = 0;
      let complete = true;
      for (const h of holdings) {
        const p = prices.get(h.coinId);
        if (p == null) {
          if (h.amount > 0) complete = false;
          continue;
        }
        value += p * h.amount;
      }
      return { value, complete };
    }),
  );

  /**
   * Transactions filtered by the selected coin. When nothing is selected,
   * all transactions are returned — that's the "general history" view.
   * Capped at 20 to keep the list scannable.
   */
  readonly visibleTransactions$: Observable<readonly Transaction[]> =
    combineLatest([this.transactions$, this.selectedCoinId$]).pipe(
      map(([txs, coinId]) => {
        const filtered = coinId == null
          ? txs
          : txs.filter((t) => t.coinId === coinId);
        return filtered.slice(0, 20);
      }),
    );

  constructor() {
    // Kick off the initial load when this state is constructed (component
    // injects it as a per-instance provider, so this fires on screen entry).
    this.store.dispatch(WalletActions.loadHoldings());
    this.store.dispatch(WalletActions.loadTransactions());
  }

  setSearch(value: string): void {
    this.store.dispatch(WalletActions.setSearch({ search: value }));
  }

  setVsCurrency(value: string): void {
    this.store.dispatch(PrefsActions.setVsCurrency({ vsCurrency: value }));
  }

  selectCoin(coinId: string | null): void {
    this.store.dispatch(WalletActions.setSelectedCoin({ coinId }));
  }

  deposit(input: {
    coinId: string;
    symbol: string;
    name: string;
    amount: number;
    note?: string;
  }): void {
    this.store.dispatch(WalletActions.deposit(input));
  }

  send(input: {
    coinId: string;
    symbol: string;
    name: string;
    amount: number;
    note?: string;
  }): void {
    this.store.dispatch(WalletActions.send(input));
  }

  clearError(): void {
    this.store.dispatch(WalletActions.clearError());
  }
}
