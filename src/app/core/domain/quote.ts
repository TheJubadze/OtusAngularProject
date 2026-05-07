export interface Quote {
  readonly coinId: string;
  readonly vsCurrency: string;
  readonly price: number;
  readonly marketCap?: number;
  readonly circulatingSupply?: number;
  readonly change24hPct?: number;
  readonly volume24h?: number;
  readonly updatedAt: Date;
}
