export type MarketSortField = 'marketCap' | 'price' | 'change24hPct' | 'name';
export type SortDirection = 'asc' | 'desc';

export interface MarketsQuery {
  readonly vsCurrency: string;
  readonly page?: number;
  readonly pageSize?: number;
  readonly sortBy?: MarketSortField;
  readonly sortDir?: SortDirection;
  readonly search?: string;
}
