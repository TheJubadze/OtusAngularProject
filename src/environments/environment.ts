/**
 * Default (committed) environment. Safe for the public repo — no secrets.
 *
 * For local development with API keys, copy this file to `environment.local.ts`
 * (which is .gitignored), fill in your values, and run:
 *
 *   npm run start:local
 *
 * angular.json's `local` build configuration swaps this file for the local one
 * at compile time.
 */
export const environment = {
  production: false,
  coingeckoApiKey: '',
  walletApiBaseUrl: 'http://localhost:3001',
};
