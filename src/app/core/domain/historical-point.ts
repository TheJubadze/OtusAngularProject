export interface HistoricalPoint {
  readonly timestamp: number;
  readonly price: number;
}

export type Range = '1m' | '1h' | '1d' | '7d' | '30d' | '90d' | '1y' | 'max';

export const ALL_RANGES: readonly Range[] = [
  '1m', '1h', '1d', '7d', '30d', '90d', '1y', 'max',
];

export function rangeLabel(range: Range): string {
  switch (range) {
    case '1m': return '1M';
    case '1h': return '1H';
    case '1d': return '1D';
    case '7d': return '7D';
    case '30d': return '30D';
    case '90d': return '90D';
    case '1y': return '1Y';
    case 'max': return 'MAX';
  }
}
