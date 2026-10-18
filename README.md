# @mutexa/liquidation-map

Public liquidation levels of Hyperliquid's largest accounts, as a library, a Hono route and a CLI.

Every open position on Hyperliquid is public, including the exact price at which it is liquidated. This package
shows what that means at scale: it ranks the leaderboard, reads the public positions of the top accounts, and
buckets their liquidatable notional by price around the mark. The totals always reconcile: in range + outside
the range + positions with no liquidation price = everything that was read.

- `rankLeaderboard()` streams Hyperliquid's leaderboard file (tens of MB) and keeps the top N accounts by
  30-day volume and by account value, without holding the file or a parsed copy in memory.
- `sampleAccounts()` reads each account's public `clearinghouseState` with a concurrency limit and a hard
  budget on upstream reads, and reports which accounts could not be read.
- `bucketize()` turns positions into price buckets: longs liquidate below the mark, shorts above.
- `createLiquidationMapRoute()` is a mountable Hono route for Cloudflare Workers that serves the sample in
  parts, and `liquidation-map` is a CLI that writes JSON and CSV.

Read-only: nothing is signed or sent. Runs on Node 22+, Cloudflare Workers and anything with `fetch` and Web
Streams.

## Data source

The leaderboard is `https://stats-data.hyperliquid.xyz/Mainnet/leaderboard`, **the file the Hyperliquid web app
loads for its leaderboard page. It is not a documented API**, and its format can change without notice. The
ranker does not assume any row order and fails loudly when it recognises fewer rows than the sample asks for,
instead of returning a short or empty map. Positions come from the documented public info API
(`clearinghouseState`), and the mark from `allMids`.

## Install

```sh
pnpm add @mutexa/liquidation-map
# optional, only for the route
pnpm add hono
```

## 30-second example

CLI:

```sh
npx @mutexa/liquidation-map --coin BTC --top 32 --out map.json --csv map.csv
```

It prints the reconciliation line to stderr and writes the full result (accounts, unread accounts, positions on
the coin, buckets, totals, sources and time) to `map.json`.

Library, from [`examples/map.ts`](examples/map.ts):

```ts
import { buildLiquidationMap } from "@mutexa/liquidation-map";

const m = await buildLiquidationMap({
  coin: "BTC",
  rank: "volume", // or "value"
  top: 32, // accounts sampled from the top of the leaderboard
  range: 0.25, // ±25% around the mark
  buckets: 40,
  concurrency: 4,
  budget: 64, // most position reads, retries included
});

const { inRange, outside, noLiq, total } = m.map;
console.log(`${m.coin} at ${m.mark}: ${m.positions.length} positions from ${m.accounts.length} accounts`);
console.log(`${inRange} in range + ${outside} outside + ${noLiq} without a liquidation price = ${total} USD`);
for (const b of m.map.buckets.filter((b) => b.longs + b.shorts > 0)) {
  console.log(`${b.lo.toFixed(0)}–${b.hi.toFixed(0)}: longs ${b.longs.toFixed(0)}, shorts ${b.shorts.toFixed(0)}`);
}
```

## CLI

```
liquidation-map --coin <COIN> --top <n> [options]

  --coin <COIN>         market to map, for example BTC (required)
  --top <n>             accounts sampled from the top of the ranking (required)
  --rank <volume|value> rank by 30-day volume or by account value (default volume)
  --range <fraction>    price range on each side of the mark (default 0.25 = ±25%)
  --buckets <n>         price buckets across the range (default 60)
  --concurrency <n>     position reads in flight (default 4)
  --budget <n>          most position reads, retries included (default 2 × top)
  --attempts <n>        most reads per account (default 2)
  --out <file>          write the JSON result to a file (default: stdout)
  --csv <file>          also write the buckets as CSV
```

Exit codes: 0 done, 1 upstream failure (for example more than half of the sample unread), 2 usage error.

## Hono route

```ts
import { Hono } from "hono";
import { createLiquidationMapRoute } from "@mutexa/liquidation-map/hono";

const app = new Hono();
app.route(
  "/api/liquidation-map",
  createLiquidationMapRoute({ partSize: 32, parts: 3, budget: 47, authorize: (c) => isSignedIn(c) }),
);
// GET /api/liquidation-map?rank=volume&part=0
```

Each request reads one part: the cached leaderboard ranking plus at most `budget` position reads. The values
above are the ones the Mutexa app uses to stay under the 50 subrequests per invocation of the Cloudflare Workers
free plan (one leaderboard fetch, 32 accounts, retries inside the remaining budget). A miss fans out to dozens of
upstream reads, so put the route behind your own sign-in with `authorize`.

## API

| Export | What it does |
|---|---|
| `rankLeaderboard(stream, { top, minRows? })` | Top `top` accounts by 30-day volume and by account value from a `ReadableStream<string>`; `rows` = rows recognised |
| `fetchLeaderboard({ fetch?, url?, timeoutMs? })` | Opens the leaderboard as a text stream |
| `sampleAccounts(accounts, { client, concurrency, budget, attempts? })` | Public positions of each account; `failed` and `used` (never above `budget`) |
| `trimPositions(account, state)` | One `clearinghouseState` → open positions with parsed numbers |
| `bucketize(positions, mark, range, buckets)` | Buckets plus `inRange`, `outside`, `noLiq`, `total` and counts |
| `bucketsToCsv(map)` | Buckets as CSV |
| `buildLiquidationMap(options)` | The whole pipeline for one coin, as the CLI runs it |
| `partOf(ranking, rank, part, partSize)`, `parseMapQuery(query, parts)` | Part slicing and query validation for routes |
| `run(argv, io)`, `parseArgs(argv)` | The CLI with injectable I/O |
| `createLiquidationMapRoute(options)` (`/hono`) | Mountable route serving `MapPart` JSON |
| `LEADERBOARD_URL`, `RANKS`, `LeaderboardError`, `SampleError` | Constants and errors |

## Tests and fixtures

- `fixtures/leaderboard.json`: the first 150 rows of the real leaderboard file, byte-for-byte in its own
  formatting, with every address replaced by a fake one (`0x…c001`, …) and display names removed.
- `fixtures/states.json`: the public `clearinghouseState` of the top 40 of those accounts by 30-day volume,
  trimmed to the fields the map reads, plus `allMids` for the coins they hold.

Both are written by `pnpm record [rows] [states]` from the live sources. The ranker is tested on that stream cut
at awkward places (inside the key, the address and the volume of every row, one to seven characters at a time,
and random sizes) and must reproduce a full `JSON.parse` ranking exactly. Bucket totals are checked to reconcile
on every recorded coin and on random positions, and the sampler is checked never to exceed its budget. CI never
touches the network; `LIVE=1 pnpm test:live` is a by-hand smoke test.

## How Mutexa uses it

This is extracted from the hunt map in the Mutexa app: the evidence for the whitepaper's problem statement that
liquidation levels of large accounts are public and cluster at prices anyone can see. Mutexa splits a position
into slices on unlinkable accounts so that it does not show up on a map like this as one large level.

## Limitations

- **Sample, not census.** The map covers the accounts you sample, ranked by the leaderboard file at the time it
  was read; it is not the whole venue.
- **Cross-margin liquidation prices move with the whole account.** They are Hyperliquid's reported values at
  the time of the read.
- **Unofficial source.** The leaderboard file can change format or move; the ranker then fails instead of
  guessing.
- **Point in time.** Positions, marks and liquidation prices change every second; every result carries
  `fetchedAt`.

Mutexa's privacy limits, for context on what a map like this can and cannot see: positions are hidden from
public trackers, not from the venues themselves; clustering by timing is still possible; very large positions
still move markets; splitting and privacy rails cost extra fees; fills that carry an integrator fee are marked as
such.

## License

MIT © 2026 Mutexa
