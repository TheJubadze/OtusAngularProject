export type CryptoErrorKind =
  | 'rate-limited'
  | 'not-found'
  | 'network'
  | 'unsupported'
  | 'unknown';

export class CryptoError extends Error {
  constructor(
    public readonly kind: CryptoErrorKind,
    message: string,
    public readonly retryAfterMs?: number,
    public override readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'CryptoError';
  }
}
