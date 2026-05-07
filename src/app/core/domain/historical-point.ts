export interface HistoricalPoint {
  readonly timestamp: number;
  readonly price: number;
}

export type Range = '1d' | '7d' | '30d' | '90d' | '1y' | 'max';
