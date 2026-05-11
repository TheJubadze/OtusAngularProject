import { Injectable, inject } from '@angular/core';
import { Store } from '@ngrx/store';
import {
  BehaviorSubject,
  EMPTY,
  Observable,
  catchError,
  combineLatest,
  distinctUntilChanged,
  filter,
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
  CryptoProviderRegistry,
} from '../../core/data';
import { CryptoError, MarketRow, Quote } from '../../core/domain';
import { PrefsActions, prefsFeature } from '../../core/store/prefs';

export type ConverterSide = 'from' | 'to';

interface PricePair {
  readonly from?: number;
  readonly to?: number;
}

const DISPLAY_PRECISION = 10;

@Injectable()
export class ConverterState {
  private readonly provider = inject(CRYPTO_PROVIDER);
  private readonly registry = inject(CryptoProviderRegistry);
  private readonly store = inject(Store);

  private readonly fromCoinIdSubject = new BehaviorSubject<string | null>(null);
  private readonly toCoinIdSubject = new BehaviorSubject<string | null>(null);
  private readonly activeSideSubject = new BehaviorSubject<ConverterSide>('from');
  private readonly activeAmountSubject = new BehaviorSubject<number>(1);
  private readonly loadingSubject = new BehaviorSubject<boolean>(false);
  private readonly errorSubject = new BehaviorSubject<string | null>(null);

  readonly fromCoinId$ = this.fromCoinIdSubject.asObservable();
  readonly toCoinId$ = this.toCoinIdSubject.asObservable();
  readonly activeSide$ = this.activeSideSubject.asObservable();
  readonly activeAmount$ = this.activeAmountSubject.asObservable();
  readonly loading$ = this.loadingSubject.asObservable();
  readonly error$ = this.errorSubject.asObservable();
  readonly vsCurrency$ = this.store.select(prefsFeature.selectVsCurrency);

  readonly supportedCurrencies$ = this.provider
    .getSupportedVsCurrencies()
    .pipe(shareReplay({ bufferSize: 1, refCount: true }));

  /**
   * Coins offered in the pickers. Refetched whenever the user switches
   * provider or vsCurrency — different providers have different coin
   * universes, and re-fetching on currency change keeps the seed prices
   * (used before the first live tick arrives) denominated correctly.
   */
  readonly coins$: Observable<readonly MarketRow[]> = combineLatest([
    this.registry.activeName$.pipe(distinctUntilChanged()),
    this.vsCurrency$.pipe(distinctUntilChanged()),
  ]).pipe(
    tap(() => {
      this.loadingSubject.next(true);
      this.errorSubject.next(null);
    }),
    switchMap(([, vsCurrency]) =>
      this.provider.getMarkets({ vsCurrency, page: 1, pageSize: 100 }).pipe(
        tap(() => this.loadingSubject.next(false)),
        catchError((err) => {
          this.loadingSubject.next(false);
          this.errorSubject.next(toMessage(err));
          return of([] as MarketRow[]);
        }),
      ),
    ),
    tap((coins) => this.ensureValidSelection(coins)),
    shareReplay({ bufferSize: 1, refCount: true }),
  );

  /**
   * Continuously updated prices for the selected pair, denominated in the
   * current vsCurrency. Restarts whenever the inputs to a request change
   * (coin id, currency, provider). Seeded synchronously from `coins$` so
   * the conversion has something to render before the first live tick.
   */
  readonly prices$: Observable<PricePair> = combineLatest([
    this.fromCoinIdSubject.pipe(
      filter((id): id is string => id != null),
      distinctUntilChanged(),
    ),
    this.toCoinIdSubject.pipe(
      filter((id): id is string => id != null),
      distinctUntilChanged(),
    ),
    this.vsCurrency$.pipe(distinctUntilChanged()),
    this.registry.activeName$.pipe(distinctUntilChanged()),
    this.coins$,
  ]).pipe(
    switchMap(([fromId, toId, vsCurrency, , coins]) => {
      const seed: PricePair = {
        from: coins.find((c) => c.id === fromId)?.price,
        to: coins.find((c) => c.id === toId)?.price,
      };
      const ids = fromId === toId ? [fromId] : [fromId, toId];
      return this.provider.liveQuotes(ids, vsCurrency).pipe(
        catchError((err) => {
          this.errorSubject.next(toMessage(err));
          return EMPTY;
        }),
        scan((acc: PricePair, q: Quote) => {
          if (q.vsCurrency !== vsCurrency) return acc;
          let next = acc;
          if (q.coinId === fromId) next = { ...next, from: q.price };
          if (q.coinId === toId) next = { ...next, to: q.price };
          return next;
        }, seed),
        startWith(seed),
      );
    }),
    shareReplay({ bufferSize: 1, refCount: true }),
  );

  readonly fromCoin$: Observable<MarketRow | null> = combineLatest([
    this.fromCoinId$,
    this.coins$,
  ]).pipe(
    map(([id, coins]) => coins.find((c) => c.id === id) ?? null),
  );

  readonly toCoin$: Observable<MarketRow | null> = combineLatest([
    this.toCoinId$,
    this.coins$,
  ]).pipe(
    map(([id, coins]) => coins.find((c) => c.id === id) ?? null),
  );

  /** Conversion rate: how many TO coins one FROM coin buys. */
  readonly rate$: Observable<number | null> = this.prices$.pipe(
    map(({ from, to }) => {
      if (from == null || to == null || to === 0) return null;
      return from / to;
    }),
    distinctUntilChanged(),
  );

  /**
   * Resolved amounts shown in each input. One side is the user-typed
   * `activeAmount`; the other is derived from rate. Rounded to a
   * fixed precision so live ticks don't push 17-digit floats into the DOM.
   */
  readonly fromAmount$: Observable<number> = combineLatest([
    this.activeSide$,
    this.activeAmount$,
    this.rate$,
  ]).pipe(
    map(([side, amount, rate]) => {
      if (side === 'from') return amount;
      if (rate == null || rate === 0) return 0;
      return roundTo(amount / rate, DISPLAY_PRECISION);
    }),
  );

  readonly toAmount$: Observable<number> = combineLatest([
    this.activeSide$,
    this.activeAmount$,
    this.rate$,
  ]).pipe(
    map(([side, amount, rate]) => {
      if (side === 'to') return amount;
      if (rate == null) return 0;
      return roundTo(amount * rate, DISPLAY_PRECISION);
    }),
  );

  setFromCoin(id: string): void {
    if (this.toCoinIdSubject.value === id) {
      const prevFrom = this.fromCoinIdSubject.value;
      if (prevFrom != null) this.toCoinIdSubject.next(prevFrom);
    }
    this.fromCoinIdSubject.next(id);
  }

  setToCoin(id: string): void {
    if (this.fromCoinIdSubject.value === id) {
      const prevTo = this.toCoinIdSubject.value;
      if (prevTo != null) this.fromCoinIdSubject.next(prevTo);
    }
    this.toCoinIdSubject.next(id);
  }

  setAmount(side: ConverterSide, amount: number): void {
    const clean = Number.isFinite(amount) && amount >= 0 ? amount : 0;
    if (this.activeSideSubject.value !== side) this.activeSideSubject.next(side);
    if (this.activeAmountSubject.value !== clean) {
      this.activeAmountSubject.next(clean);
    }
  }

  swap(): void {
    const from = this.fromCoinIdSubject.value;
    const to = this.toCoinIdSubject.value;
    if (from == null || to == null) return;
    this.fromCoinIdSubject.next(to);
    this.toCoinIdSubject.next(from);
    // Keep the active side anchored to whichever input the user last touched,
    // so swapping doesn't silently reassign which input is the "source of truth".
    this.activeSideSubject.next(
      this.activeSideSubject.value === 'from' ? 'to' : 'from',
    );
  }

  setVsCurrency(value: string): void {
    this.store.dispatch(PrefsActions.setVsCurrency({ vsCurrency: value }));
  }

  /**
   * Picks defaults when the page first loads, and recovers when the active
   * provider changes to one whose coin universe doesn't include our current
   * selection (e.g. user-typed Mock id won't exist on Binance).
   */
  private ensureValidSelection(coins: readonly MarketRow[]): void {
    if (coins.length === 0) return;
    const ids = new Set(coins.map((c) => c.id));
    const findBySymbol = (sym: string) =>
      coins.find((c) => c.symbol.toLowerCase() === sym)?.id;

    const currentFrom = this.fromCoinIdSubject.value;
    if (currentFrom == null || !ids.has(currentFrom)) {
      this.fromCoinIdSubject.next(findBySymbol('btc') ?? coins[0].id);
    }
    const fromAfter = this.fromCoinIdSubject.value!;
    const currentTo = this.toCoinIdSubject.value;
    if (currentTo == null || !ids.has(currentTo) || currentTo === fromAfter) {
      const eth = findBySymbol('eth');
      const fallback = coins.find((c) => c.id !== fromAfter)?.id ?? coins[0].id;
      this.toCoinIdSubject.next(eth && eth !== fromAfter ? eth : fallback);
    }
  }
}

function toMessage(err: unknown): string {
  if (err instanceof CryptoError) return err.message;
  if (err instanceof Error) return err.message;
  return 'Unknown error';
}

function roundTo(value: number, sigDigits: number): number {
  if (!Number.isFinite(value) || value === 0) return value;
  return Number(value.toPrecision(sigDigits));
}
