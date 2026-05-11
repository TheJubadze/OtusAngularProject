# Crypto Platform

Angular 21 SPA for browsing crypto markets, converting between coins, and
managing a fake wallet. Built as the "Theme 2: Crypto Platform" project
for an Otus Angular course.

Three core screens — **Watchlist**, **Converter**, **Wallet** — share a
NgRx-backed preferences slice and pull data through a runtime-switchable
provider abstraction (Mock / CoinGecko / Binance Live).

## Quick start

```bash
npm install

# In one terminal: the fake backend for the Wallet feature.
npm run wallet:server      # json-server on http://localhost:3001

# In another: the Angular dev server.
npm start                  # http://localhost:4200
```

Open <http://localhost:4200> — you land on the Watchlist by default.

Tests: `npm test` (Vitest, runs in watch mode by default).

## Features

Per the assignment:

| Screen        | Status | Notes |
|---------------|--------|-------|
| Watchlist     | ✓      | Name, symbol, price, market cap, supply, 24h change, 7d sparkline. Sortable by any column; defaults to market cap desc. Click a row for a detail panel with line/candle charts, range switcher, and live updates. |
| Converter     | ✓      | Two-coin picker with bidirectional amount inputs, swap button, live cross-rate, real-time ticks. |
| Wallet        | ✓      | Persisted via `json-server` (see `db.json`). Portfolio total in the active currency, deposit/send forms, transaction log filterable by selected coin. |

Optional features (the assignment asks for 3+; the project ships 4):

- ✓ **Shared currency selector** wired through `prefs` slice — switch USD/EUR/RUB/BTC on any screen and the rest follow.
- ✓ **Shared search component** ([`shared/search-box`](src/app/shared/search-box/search-box.ts)) used by both Watchlist and Wallet — one debounce/distinct pipeline, two hosts.
- ✓ **Price chart column** — sparkline per row plus full line/candle charts with moving averages in the detail panel.
- ✓ **Dark / light theme** toggle in the header. Hydrated from `localStorage`, applied via a CSS-variable layer in `styles.scss`.

## Architecture

```
src/app/
├── core/
│   ├── data/             provider interface, registry, four implementations
│   │   └── providers/    mock | coingecko | binance | routing (delegator)
│   ├── domain/           Coin, Quote, MarketRow, Candle, Holding, Transaction…
│   └── store/
│       ├── prefs/        theme + vsCurrency slice with localStorage persistence
│       └── wallet/       NgRx feature + effects driving json-server CRUD
├── features/
│   ├── watchlist/        + nested coin-detail/ panel
│   ├── converter/
│   └── wallet/
└── shared/
    ├── search-box/       reused by Watchlist and Wallet
    ├── sparkline/        Chart.js line, used in Watchlist rows
    ├── price-chart/      Chart.js line, used in coin detail
    ├── candle-chart/     Chart.js + chartjs-chart-financial with MAs
    └── price-flash/      directive that flashes green/red on price ticks
```

**Provider switching.** `CryptoDataProvider` is the source-agnostic
interface; each implementation translates its DTOs into the domain
models. A registry multi-provider token lets Mock/CoinGecko/Binance all
register at boot, and `RoutingCryptoProvider` delegates each call to the
currently-active one. The header `Source:` buttons flip the active
provider; pipelines that depend on `registry.activeName$` restart so no
provider-specific ids leak across.

**State.** Two NgRx feature slices — `prefs` (theme, vsCurrency) and
`wallet` (holdings, transactions, plus loading/error/selection flags).
`WalletEffects` does fetch-fresh-then-mutate against `json-server` so
upsert/balance decisions are based on authoritative server state rather
than whatever happens to be in the store.

**Change detection.** Every component is OnPush; observables drive the
templates via the `async` pipe.

## Scripts

| Command                 | What it does                                                     |
|-------------------------|------------------------------------------------------------------|
| `npm start`             | Angular dev server on :4200                                      |
| `npm run start:local`   | Same, but swaps in `environment.local.ts` (gitignored, for keys) |
| `npm run wallet:server` | `json-server --watch db.json --port 3001`                        |
| `npm test`              | Vitest unit tests (watch mode; `q` to quit)                      |
| `npm run build`         | Production build to `dist/`                                      |

## Environment

`src/environments/environment.ts` is committed and intentionally empty
of secrets. For local development with a real CoinGecko demo key,
copy it to `environment.local.ts` (which is `.gitignored`):

```ts
export const environment = {
  production: false,
  coingeckoApiKey: 'CG-xxxxxxxxxxxxxxxx',
  walletApiBaseUrl: 'http://localhost:3001',
};
```

Then run `npm run start:local`. Without a key, the CoinGecko provider
still works on the public anonymous rate-limit; it's just slower and
less reliable.

The Binance provider needs no key — its public REST + WebSocket
endpoints are open. The Mock provider needs nothing at all.

## Notes & known limits

- Cross-provider coin ids aren't reconciled: Mock and CoinGecko use
  `bitcoin` / `ethereum`, Binance uses lowercase symbols (`btc` / `eth`).
  Holdings stored under one provider's ids show no price when you flip
  to a provider that uses different ids — the row falls back to "—".
- The Binance WebSocket reconnects with exponential backoff (2s → 30s,
  capped, with jitter) and no retry cap, which keeps the live stream
  alive across temporary outages without hammering the server.
