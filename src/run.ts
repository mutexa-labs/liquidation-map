import type { FetchLike } from "@mutexa/venue-adapters";
import { bucketsToCsv } from "./bucket";
import { buildLiquidationMap } from "./build";
import { RANKS, type Rank } from "./types";

export const HELP = `liquidation-map: public liquidation levels of Hyperliquid's largest accounts

Usage:
  liquidation-map --coin <COIN> --top <n> [options]

Options:
  --coin <COIN>        market to map, for example BTC (required)
  --top <n>            accounts sampled from the top of the ranking (required)
  --rank <volume|value> rank by 30-day volume or by account value (default volume)
  --range <fraction>   price range on each side of the mark (default 0.25 = ±25%)
  --buckets <n>        price buckets across the range (default 60)
  --concurrency <n>    position reads in flight (default 4)
  --budget <n>         most position reads, retries included (default 2 × top)
  --attempts <n>       most reads per account (default 2)
  --out <file>         write the JSON result to a file (default: stdout)
  --csv <file>         also write the buckets as CSV
  -h, --help           show this help

Source: the leaderboard file the Hyperliquid web app loads (not a documented API) and each account's public
clearinghouseState. Read-only; nothing is signed or sent.`;

export type RunIO = {
  fetch?: FetchLike;
  leaderboard?: () => Promise<ReadableStream<string>>;
  writeFile: (path: string, data: string) => Promise<void>;
  stdout: (s: string) => void;
  stderr: (s: string) => void;
  now?: () => number;
};

export class UsageError extends Error {
  override name = "UsageError";
}

export type CliOptions = {
  coin: string;
  top: number;
  rank: Rank;
  range: number;
  buckets: number;
  concurrency: number;
  budget: number;
  attempts: number;
  out?: string;
  csv?: string;
  help: boolean;
};

export function parseArgs(argv: string[]): CliOptions {
  const raw: Record<string, string> = {};
  let help = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "-h" || a === "--help") {
      help = true;
      continue;
    }
    if (!a.startsWith("--")) throw new UsageError(`Unexpected argument: ${a}`);
    const eq = a.indexOf("=");
    const flag = eq > 0 ? a.slice(2, eq) : a.slice(2);
    const v = eq > 0 ? a.slice(eq + 1) : argv[++i];
    if (v === undefined || v.startsWith("--")) throw new UsageError(`--${flag} needs a value`);
    if (!["coin", "top", "rank", "range", "buckets", "concurrency", "budget", "attempts", "out", "csv"].includes(flag))
      throw new UsageError(`Unknown option: --${flag}`);
    raw[flag] = v;
  }
  if (help)
    return { help, coin: "", top: 0, rank: "volume", range: 0, buckets: 0, concurrency: 0, budget: 0, attempts: 0 };
  const int = (k: string, d?: number) => {
    const s = raw[k];
    if (s === undefined) {
      if (d === undefined) throw new UsageError(`--${k} is required`);
      return d;
    }
    const n = Number(s);
    if (!Number.isInteger(n) || n < 1) throw new UsageError(`--${k} must be a positive integer`);
    return n;
  };
  if (!raw.coin) throw new UsageError("--coin is required");
  if (!/^[A-Za-z0-9:_-]{1,32}$/.test(raw.coin)) throw new UsageError("--coin is invalid");
  const rank = (raw.rank ?? "volume") as Rank;
  if (!(RANKS as readonly string[]).includes(rank)) throw new UsageError(`--rank must be one of ${RANKS.join(", ")}`);
  const range = raw.range === undefined ? 0.25 : Number(raw.range);
  if (!(range > 0 && range < 1)) throw new UsageError("--range must be between 0 and 1");
  const top = int("top");
  return {
    help,
    coin: raw.coin,
    top,
    rank,
    range,
    buckets: int("buckets", 60),
    concurrency: int("concurrency", 4),
    budget: int("budget", 2 * top),
    attempts: int("attempts", 2),
    out: raw.out,
    csv: raw.csv,
  };
}

/** Runs the CLI; returns the exit code. All I/O goes through `io`, so tests can run it without a network. */
export async function run(argv: string[], io: RunIO): Promise<number> {
  let o: CliOptions;
  try {
    o = parseArgs(argv);
  } catch (e) {
    io.stderr(`${e instanceof Error ? e.message : String(e)}\n\n${HELP}\n`);
    return 2;
  }
  if (o.help) {
    io.stdout(HELP + "\n");
    return 0;
  }
  try {
    const m = await buildLiquidationMap({ ...o, fetch: io.fetch, leaderboard: io.leaderboard, now: io.now });
    const json = JSON.stringify(m, null, 2) + "\n";
    if (o.out) await io.writeFile(o.out, json);
    else io.stdout(json);
    if (o.csv) await io.writeFile(o.csv, bucketsToCsv(m.map));
    const t = m.map;
    io.stderr(
      `${m.coin} mark ${m.mark}: ${m.positions.length} positions from ${m.accounts.length} accounts (${m.failed.length} unread). ` +
        `in range ${t.inRange.toFixed(2)} + outside ${t.outside.toFixed(2)} + no liq price ${t.noLiq.toFixed(2)} = ${t.total.toFixed(2)} USD\n`,
    );
    return 0;
  } catch (e) {
    io.stderr(`error: ${e instanceof Error ? e.message : String(e)}\n`);
    return 1;
  }
}
