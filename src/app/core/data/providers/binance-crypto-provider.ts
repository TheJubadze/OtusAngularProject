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
  defer,
  map,
  of,
  retry,
  throwError,
  timer,
} from 'rxjs';
import { WebSocketSubject, webSocket } from 'rxjs/webSocket';

import {
  Candle,
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
 * Binance Spot adapter. Uses public REST for static lookups and a single
 * shared public WebSocket connection for ALL real-time streams.
 *
 * Caveats vs. CoinGecko:
 * - No marketCap or circulatingSupply (Binance is an exchange, not an
 *   aggregator). Those fields stay undefined and the UI shows "—".
 * - No logos or full coin names — we ship a small lookup table for popular
 *   coins, otherwise display the symbol as the name.
 * - Pairs are quote-currency-prefixed: 'usd' maps to 'USDT' (most liquid),
 *   'eur' to 'EUR', 'btc' to 'BTC'. RUB/etc. are not supported.
 *
 * Streaming model: instead of opening a new WebSocket per stream (and
 * leaking connections every time the user changes range), we keep a
 * single WebSocketSubject and use `multiplex` to add/remove individual
 * streams via SUBSCRIBE / UNSUBSCRIBE control messages. This is how
 * professional trading terminals do it.
 */
@Injectable({ providedIn: 'root' })
export class BinanceCryptoProvider implements CryptoDataProvider {
  private readonly http = inject(HttpClient);
  private readonly base = 'https://api.binance.com/api/v3';
  private readonly wsBase = 'wss://stream.binance.com:9443/stream';

  /** Single shared WebSocket. Lazily opened on the first multiplex
   *  subscription and torn down by the subject when the last consumer
   *  unsubscribes; the closeObserver clears the reference so the next
   *  subscriber rebuilds it. */
  private socket?: WebSocketSubject<unknown>;
  private nextMessageId = 1;

  private getSocket(): WebSocketSubject<unknown> {
    if (!this.socket) {
      this.socket = webSocket<unknown>({
        url: this.wsBase,
        closeObserver: { next: () => { this.socket = undefined; } },
      });
    }
    return this.socket;
  }

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

  getCandles(
    coinId: string,
    vsCurrency: string,
    range: Range,
  ): Observable<Candle[]> {
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
          klines.map<Candle>((k) => ({
            timestamp: k[0],
            open: Number.parseFloat(k[1]),
            high: Number.parseFloat(k[2]),
            low: Number.parseFloat(k[3]),
            close: Number.parseFloat(k[4]),
            volume: Number.parseFloat(k[5]),
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

    const symbols = coinIds.map(
      (id) => `${id.toLowerCase()}${quote.toLowerCase()}`,
    );
    const streams = symbols.map((s) => `${s}@miniTicker`);
    const streamSet = new Set(streams);
    const subId = this.nextMessageId++;
    const unsubId = this.nextMessageId++;
    const vs = vsCurrency.toLowerCase();

    return defer(() =>
      this.getSocket().multiplex(
        () => ({ method: 'SUBSCRIBE', params: streams, id: subId }),
        () => ({ method: 'UNSUBSCRIBE', params: streams, id: unsubId }),
        (msg) => streamSet.has(streamOf(msg)),
      ),
    ).pipe(
      retry({ delay: wsRetryDelay }),
      map((msg) => streamToQuote((msg as BinanceStreamMessage).data, quote, vs)),
    );
  }

  liveCandles(
    coinId: string,
    vsCurrency: string,
    range: Range,
  ): Observable<Candle> {
    const quote = mapVsCurrency(vsCurrency);
    if (!quote) return EMPTY;
    const interval = rangeToBinanceInterval(range);
    const symbol = `${coinId.toLowerCase()}${quote.toLowerCase()}`;
    const stream = `${symbol}@kline_${interval}`;
    const subId = this.nextMessageId++;
    const unsubId = this.nextMessageId++;

    return defer(() =>
      this.getSocket().multiplex(
        () => ({ method: 'SUBSCRIBE', params: [stream], id: subId }),
        () => ({ method: 'UNSUBSCRIBE', params: [stream], id: unsubId }),
        (msg) => streamOf(msg) === stream,
      ),
    ).pipe(
      retry({ delay: wsRetryDelay }),
      map((msg) =>
        klineEventToCandle((msg as BinanceKlineStreamMessage).data.k),
      ),
    );
  }

  getSupportedVsCurrencies(): Observable<readonly string[]> {
    // Mirrors what `mapVsCurrency` actually accepts — `usdt` maps to itself,
    // the rest get an equivalent quote symbol.
    return of(['usd', 'usdt', 'eur', 'btc']);
  }
}

/**
 * Reconnect schedule for both `liveQuotes` and `liveCandles`. Returns the
 * delay until the next attempt. Exponential 2s → 4s → 8s → 16s → 30s,
 * capped at 30s, with ±15 % jitter so a wave of disconnected clients
 * doesn't reconnect in lockstep. Retries are unbounded — a permanent
 * loss of the live stream would otherwise leave the watchlist silently
 * frozen.
 */
function wsRetryDelay(_err: unknown, attempt: number): Observable<number> {
  const cap = 30_000;
  const base = Math.min(cap, 1000 * Math.pow(2, Math.min(attempt, 5)));
  const jitter = base * (Math.random() * 0.3 - 0.15);
  return timer(Math.max(500, base + jitter));
}

interface BinanceTicker24hDto {
  symbol: string;
  lastPrice: string;
  priceChangePercent: string;
  quoteVolume: string;
  volume: string;
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

interface BinanceKlineEvent {
  e: 'kline';
  E: number;
  s: string;
  k: {
    t: number; // kline open time
    T: number; // kline close time
    i: string; // interval
    o: string; // open
    h: string; // high
    l: string; // low
    c: string; // close
    v: string; // volume
    x: boolean; // is closed
    q: string; // quote volume
  };
}

interface BinanceKlineStreamMessage {
  stream: string;
  data: BinanceKlineEvent;
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
    volume24h: Number.parseFloat(dto.quoteVolume),
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
    volume24h: Number.parseFloat(dto.quoteVolume),
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
    volume24h: Number.parseFloat(msg.q),
    updatedAt: new Date(msg.E),
  };
}

function rangeToKlineParams(range: Range): {
  interval: string;
  limit: number;
} {
  return { interval: rangeToBinanceInterval(range), limit: rangeKlineLimit(range) };
}

function rangeToBinanceInterval(range: Range): string {
  switch (range) {
    case '1m': return '1s';
    case '1h': return '1m';
    case '1d': return '15m';
    case '7d': return '1h';
    case '30d': return '4h';
    case '90d': return '1d';
    case '1y': return '1d';
    case 'max': return '1w';
  }
}

/**
 * Each visible-window count is padded by ~MA(99) lookback so all three
 * moving averages can be computed in full and rendered from the leftmost
 * candle of the displayed area (the chart clips the leading lookback
 * portion via x-axis min).
 */
function rangeKlineLimit(range: Range): number {
  switch (range) {
    case '1m': return 160;   // 60 visible + 100 lookback
    case '1h': return 160;
    case '1d': return 196;   // 96 + 100
    case '7d': return 268;   // 168 + 100
    case '30d': return 280;  // 180 + 100
    case '90d': return 190;  // 90 + 100
    case '1y': return 465;   // 365 + 100
    case 'max': return 1000; // hits Binance's per-call cap
  }
}

/**
 * Safely extract the stream name from an incoming message. Combined-stream
 * data messages have shape `{ stream: '...', data: {...} }`; control-message
 * acks (e.g. `{ result: null, id: 1 }`) have neither and are filtered out
 * by everyone.
 */
function streamOf(msg: unknown): string {
  if (typeof msg !== 'object' || msg === null) return '';
  const stream = (msg as { stream?: unknown }).stream;
  return typeof stream === 'string' ? stream : '';
}

function klineEventToCandle(k: BinanceKlineEvent['k']): Candle {
  return {
    timestamp: k.t,
    open: Number.parseFloat(k.o),
    high: Number.parseFloat(k.h),
    low: Number.parseFloat(k.l),
    close: Number.parseFloat(k.c),
    volume: Number.parseFloat(k.v),
  };
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
