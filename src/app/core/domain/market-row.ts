import { Coin } from './coin';
import { Quote } from './quote';

export interface MarketRow extends Coin {
  readonly vsCurrency: string;
  readonly price: number;
  readonly marketCap?: number;
  readonly circulatingSupply?: number;
  readonly change24hPct?: number;
  readonly updatedAt: Date;
}

export function toMarketRow(coin: Coin, quote: Quote): MarketRow {
  return {
    ...coin,
    vsCurrency: quote.vsCurrency,
    price: quote.price,
    marketCap: quote.marketCap,
    circulatingSupply: quote.circulatingSupply,
    change24hPct: quote.change24hPct,
    updatedAt: quote.updatedAt,
  };
}
