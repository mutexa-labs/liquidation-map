# Changelog

All notable changes to this package are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow semver (`0.x`: minor bumps may
change the API).

## [0.1.1] - 2026-10-19

### Fixed

- `createLiquidationMapRoute` declares its `Hono` return type, and `@mutexa/venue-adapters` moves to v0.1.1, so the
  declaration build succeeds when the package is installed from git.

## [0.1.0] - 2026-10-18

### Added

- `rankLeaderboard`: streaming top-N ranker over Hyperliquid's leaderboard file, by 30-day volume and account
  value, with a loud failure when too few rows are recognised.
- `sampleAccounts`: public position reads with a concurrency limit, a hard read budget and per-account attempts.
- `bucketize`: liquidatable notional per price bucket with reconciling in-range, outside and no-liquidation
  totals; `bucketsToCsv`.
- `buildLiquidationMap`: the whole pipeline for one coin.
- `createLiquidationMapRoute`: mountable Hono route serving the sample in parts (`@mutexa/liquidation-map/hono`).
- `liquidation-map` CLI writing JSON and CSV.
- Recorded leaderboard stream and account states with fake addresses, and the recorder script.
