import { Coin } from './coin';
import { HistoricalPoint } from './historical-point';
import { Quote } from './quote';

export interface MarketRow extends Coin {
  readonly vsCurrency: string;
  readonly price: number;
  readonly marketCap?: number;
  readonly circulatingSupply?: number;
  readonly change24hPct?: number;
  readonly volume24h?: number;
  readonly updatedAt: Date;
  /**
   * Optional inline price history. Providers that can return it cheaply
   * as part of getMarkets (e.g. CoinGecko's sparkline=true) populate this
   * field; consumers may use it directly instead of calling getHistory.
   */
  readonly history?: readonly HistoricalPoint[];
}

export function toMarketRow(coin: Coin, quote: Quote): MarketRow {
  return {
    ...coin,
    vsCurrency: quote.vsCurrency,
    price: quote.price,
    marketCap: quote.marketCap,
    circulatingSupply: quote.circulatingSupply,
    change24hPct: quote.change24hPct,
    volume24h: quote.volume24h,
    updatedAt: quote.updatedAt,
  };
}
