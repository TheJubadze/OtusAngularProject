import {
  HttpClient,
  HttpErrorResponse,
  HttpParams,
} from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import {
  EMPTY,
  Observable,
  catchError,
  map,
  of,
  retry,
  throwError,
} from 'rxjs';
import { webSocket } from 'rxjs/webSocket';

import {
  Coin,
  CryptoError,
  HistoricalPoint,
  MarketRow,
  Quote,
  Range,
} from '../../domain';
import { CryptoDataProvider } from '../crypto-data-provider';
import { MarketsQuery } from '../markets-query';

/**
 * Binance Spot adapter. Uses public REST for static lookups and a public
 * WebSocket stream for real-time quotes — no auth required.
 *
 * Caveats vs. CoinGecko:
 * - No marketCap or circulatingSupply (Binance is an exchange, not an
 *   aggregator). Those fields stay undefined and the UI shows "—".
 * - No logos or full coin names — we ship a small lookup table for popular
 *   coins, otherwise display the symbol as the name.
 * - Pairs are quote-currency-prefixed: 'usd' maps to 'USDT' (most liquid),
 *   'eur' to 'EUR', 'btc' to 'BTC'. RUB/etc. are not supported.
 *
 * The win: liveQuotes ticks at sub-second cadence over WebSocket, no
 * polling, no rate-limit dance.
 */
@Injectable({ providedIn: 'root' })
export class BinanceCryptoProvider implements CryptoDataProvider {
  private readonly http = inject(HttpClient);
  private readonly base = 'https://api.binance.com/api/v3';
  private readonly wsBase = 'wss://stream.binance.com:9443/stream';

  getMarkets(query: MarketsQuery): Observable<MarketRow[]> {
    const quote = mapVsCurrency(query.vsCurrency);
    if (!quote) {
      return throwError(
        () =>
          new CryptoError(
            'unsupported',
            `Binance does not support vs currency "${query.vsCurrency}"`,
          ),
      );
    }
    return this.http
      .get<BinanceTicker24hDto[]>(`${this.base}/ticker/24hr`)
      .pipe(
        map((dtos) => {
          const filtered = dtos
            .filter((t) => isCleanPair(t.symbol, quote))
            .sort(
              (a, b) =>
                Number.parseFloat(b.quoteVolume) -
                Number.parseFloat(a.quoteVolume),
            )
            .slice(0, query.pageSize ?? 50);
          const search = (query.search ?? '').trim().toLowerCase();
          const matched = search
            ? filtered.filter((t) => {
                const base = stripQuote(t.symbol, quote).toLowerCase();
                return (
                  base.includes(search) ||
                  (COIN_NAMES[base.toUpperCase()] ?? base)
                    .toLowerCase()
                    .includes(search)
                );
              })
            : filtered;
          return matched.map((t) =>
            tickerToMarketRow(t, query.vsCurrency.toLowerCase(), quote),
          );
        }),
        catchError((err) => throwError(() => mapHttpError(err))),
      );
  }

  getQuote(coinId: string, vsCurrency: string): Observable<Quote> {
    const quote = mapVsCurrency(vsCurrency);
    if (!quote) {
      return throwError(
        () => new CryptoError('unsupported', `${vsCurrency} not supported`),
      );
    }
    const symbol = `${coinId.toUpperCase()}${quote}`;
    const params = new HttpParams().set('symbol', symbol);
    return this.http
      .get<BinanceTicker24hDto>(`${this.base}/ticker/24hr`, { params })
      .pipe(
        map((t) => tickerToQuote(t, coinId, vsCurrency.toLowerCase())),
        catchError((err) => throwError(() => mapHttpError(err))),
      );
  }

  getHistory(
    coinId: string,
    vsCurrency: string,
    range: Range,
  ): Observable<HistoricalPoint[]> {
    const quote = mapVsCurrency(vsCurrency);
    if (!quote) {
      return throwError(
        () => new CryptoError('unsupported', `${vsCurrency} not supported`),
      );
    }
    const { interval, limit } = rangeToKlineParams(range);
    const params = new HttpParams()
      .set('symbol', `${coinId.toUpperCase()}${quote}`)
      .set('interval', interval)
      .set('limit', String(limit));
    return this.http
      .get<BinanceKline[]>(`${this.base}/klines`, { params })
      .pipe(
        map((klines) =>
          klines.map<HistoricalPoint>((k) => ({
            timestamp: k[0],
            price: Number.parseFloat(k[4]), // close
          })),
        ),
        catchError((err) => throwError(() => mapHttpError(err))),
      );
  }

  searchCoins(query: string): Observable<Coin[]> {
    const q = query.trim().toLowerCase();
    return this.http
      .get<BinanceTicker24hDto[]>(`${this.base}/ticker/24hr`)
      .pipe(
        map((dtos) => {
          const usdt = dtos
            .filter((t) => isCleanPair(t.symbol, 'USDT'))
            .sort(
              (a, b) =>
                Number.parseFloat(b.quoteVolume) -
                Number.parseFloat(a.quoteVolume),
            )
            .slice(0, 100);
          const matched = q
            ? usdt.filter((t) => {
                const base = stripQuote(t.symbol, 'USDT').toLowerCase();
                return (
                  base.includes(q) ||
                  (COIN_NAMES[base.toUpperCase()] ?? base)
                    .toLowerCase()
                    .includes(q)
                );
              })
            : usdt;
          return matched.map<Coin>((t) => {
            const sym = stripQuote(t.symbol, 'USDT');
            return {
              id: sym.toLowerCase(),
              symbol: sym,
              name: COIN_NAMES[sym] ?? sym,
            };
          });
        }),
        catchError((err) => throwError(() => mapHttpError(err))),
      );
  }

  liveQuotes(
    coinIds: readonly string[],
    vsCurrency: string,
  ): Observable<Quote> {
    if (coinIds.length === 0) return EMPTY;
    const quote = mapVsCurrency(vsCurrency);
    if (!quote) return EMPTY;

    const symbols = coinIds.map((id) => `${id.toLowerCase()}${quote.toLowerCase()}`);
    const streams = symbols.map((s) => `${s}@miniTicker`).join('/');
    const url = `${this.wsBase}?streams=${streams}`;
    const vs = vsCurrency.toLowerCase();

    return webSocket<BinanceStreamMessage>(url).pipe(
      // retry the underlying connection if it drops; switchMap upstream
      // unsubscribes us anyway when the consumer changes provider.
      retry({ delay: 5000 }),
      map((msg) => streamToQuote(msg.data, quote, vs)),
    );
  }

  getSupportedVsCurrencies(): Observable<readonly string[]> {
    return of(['usd', 'eur', 'btc']);
  }
}

interface BinanceTicker24hDto {
  symbol: string;
  lastPrice: string;
  priceChangePercent: string;
  quoteVolume: string;
  openPrice: string;
  closeTime: number;
}

type BinanceKline = [
  number, // open time
  string, // open
  string, // high
  string, // low
  string, // close
  string, // volume
  number, // close time
  string, // quote asset volume
  number,
  string,
  string,
  string,
];

interface BinanceMiniTicker {
  e: '24hrMiniTicker';
  E: number;
  s: string; // symbol e.g. "BTCUSDT"
  c: string; // close price
  o: string; // open price
  h: string;
  l: string;
  v: string;
  q: string;
}

interface BinanceStreamMessage {
  stream: string;
  data: BinanceMiniTicker;
}

const COIN_NAMES: Record<string, string> = {
  BTC: 'Bitcoin',
  ETH: 'Ethereum',
  USDT: 'Tether',
  BNB: 'BNB',
  SOL: 'Solana',
  XRP: 'XRP',
  USDC: 'USD Coin',
  ADA: 'Cardano',
  DOGE: 'Dogecoin',
  TRX: 'TRON',
  AVAX: 'Avalanche',
  DOT: 'Polkadot',
  MATIC: 'Polygon',
  LINK: 'Chainlink',
  TON: 'Toncoin',
  SHIB: 'Shiba Inu',
  LTC: 'Litecoin',
  BCH: 'Bitcoin Cash',
  XLM: 'Stellar',
  ATOM: 'Cosmos',
  ETC: 'Ethereum Classic',
  HBAR: 'Hedera',
  XMR: 'Monero',
  APT: 'Aptos',
  ARB: 'Arbitrum',
  OP: 'Optimism',
  NEAR: 'NEAR Protocol',
  ICP: 'Internet Computer',
  FIL: 'Filecoin',
  PEPE: 'Pepe',
  UNI: 'Uniswap',
  AAVE: 'Aave',
  SUI: 'Sui',
  INJ: 'Injective',
  RUNE: 'THORChain',
  MKR: 'Maker',
  GRT: 'The Graph',
  IMX: 'Immutable',
  FTM: 'Fantom',
  ALGO: 'Algorand',
};

const LEVERAGED_SUFFIXES = ['UPUSDT', 'DOWNUSDT', 'BULLUSDT', 'BEARUSDT'];

function mapVsCurrency(vs: string): string | null {
  switch (vs.toLowerCase()) {
    case 'usd':
    case 'usdt':
      return 'USDT';
    case 'eur':
      return 'EUR';
    case 'btc':
      return 'BTC';
    default:
      return null;
  }
}

function isCleanPair(symbol: string, quote: string): boolean {
  if (!symbol.endsWith(quote)) return false;
  if (LEVERAGED_SUFFIXES.some((suf) => symbol.endsWith(suf))) return false;
  // Stable-on-stable noise: e.g. BUSDUSDT, FDUSDUSDT — keep some, drop most.
  const base = stripQuote(symbol, quote);
  if (base.length < 2 || base.length > 8) return false;
  return /^[A-Z0-9]+$/.test(base);
}

function stripQuote(symbol: string, quote: string): string {
  return symbol.slice(0, symbol.length - quote.length);
}

function tickerToMarketRow(
  dto: BinanceTicker24hDto,
  vsCurrency: string,
  quote: string,
): MarketRow {
  const base = stripQuote(dto.symbol, quote);
  return {
    id: base.toLowerCase(),
    symbol: base,
    name: COIN_NAMES[base] ?? base,
    vsCurrency,
    price: Number.parseFloat(dto.lastPrice),
    change24hPct: Number.parseFloat(dto.priceChangePercent),
    updatedAt: new Date(dto.closeTime),
  };
}

function tickerToQuote(
  dto: BinanceTicker24hDto,
  coinId: string,
  vsCurrency: string,
): Quote {
  return {
    coinId,
    vsCurrency,
    price: Number.parseFloat(dto.lastPrice),
    change24hPct: Number.parseFloat(dto.priceChangePercent),
    updatedAt: new Date(dto.closeTime),
  };
}

function streamToQuote(
  msg: BinanceMiniTicker,
  quote: string,
  vsCurrency: string,
): Quote {
  const base = stripQuote(msg.s, quote);
  const open = Number.parseFloat(msg.o);
  const close = Number.parseFloat(msg.c);
  const change24hPct = open > 0 ? ((close - open) / open) * 100 : 0;
  return {
    coinId: base.toLowerCase(),
    vsCurrency,
    price: close,
    change24hPct,
    updatedAt: new Date(msg.E),
  };
}

function rangeToKlineParams(range: Range): {
  interval: string;
  limit: number;
} {
  switch (range) {
    case '1d': return { interval: '1h', limit: 24 };
    case '7d': return { interval: '1h', limit: 168 };
    case '30d': return { interval: '4h', limit: 180 };
    case '90d': return { interval: '1d', limit: 90 };
    case '1y': return { interval: '1d', limit: 365 };
    case 'max': return { interval: '1w', limit: 1000 };
  }
}

function mapHttpError(err: unknown): CryptoError {
  if (!(err instanceof HttpErrorResponse)) {
    return new CryptoError('unknown', 'Unexpected error', undefined, err);
  }
  if (err.status === 429 || err.status === 418) {
    return new CryptoError(
      'rate-limited',
      'Binance rate limit exceeded',
      undefined,
      err,
    );
  }
  if (err.status === 0) {
    return new CryptoError('network', 'Network error', undefined, err);
  }
  return new CryptoError(
    'unknown',
    `Binance ${err.status}: ${err.statusText}`,
    undefined,
    err,
  );
}
