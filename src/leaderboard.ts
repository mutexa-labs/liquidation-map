import type { FetchLike } from "@mutexa/venue-adapters";
import type { RankedAccount, Ranking } from "./types";

/**
 * Hyperliquid's leaderboard file: the file app.hyperliquid.xyz/leaderboard loads. It is not a documented API and
 * its format can change; the ranker fails loudly when it recognises fewer rows than asked for.
 */
export const LEADERBOARD_URL = "https://stats-data.hyperliquid.xyz/Mainnet/leaderboard";

// One leaderboard row, pretty-printed by Hyperliquid as:
//   "ethAddress": "0x…", "accountValue": "…", "windowPerformances": [["day", {…}], ["week", {…}], ["month", {"pnl": …, "roi": …, "vlm": "…"}], …
const ROW =
  /"ethAddress":\s*"(0x[0-9a-fA-F]{40})",\s*"accountValue":\s*"(-?[0-9.eE+-]+)",\s*"windowPerformances":\s*\[\s*\[\s*"day",\s*\{[^}]*\}\s*\],\s*\[\s*"week",\s*\{[^}]*\}\s*\],\s*\[\s*"month",\s*\{[^}]*?"vlm":\s*"(-?[0-9.eE+-]+)"/g;

/** A row is well under this many characters; an unmatched tail longer than twice this is trimmed. */
const MAX_ROW = 4096;

export class LeaderboardError extends Error {
  override name = "LeaderboardError";
}

export type RankOptions = {
  /** Accounts kept per ranking. */
  top: number;
  /** Fail when fewer rows than this are recognised. Defaults to `top`. */
  minRows?: number;
};

type Row = { a: string; v: number; m: number };

/**
 * Scans the leaderboard as a stream of text and keeps the top accounts by 30-day volume and by account value.
 * Never holds the whole file or a parsed copy in memory: matched rows are consumed, the unmatched tail (a row split
 * across chunks) is carried into the next chunk, and the candidate lists are trimmed as they grow.
 */
export async function rankLeaderboard(stream: ReadableStream<string>, opts: RankOptions): Promise<Ranking> {
  const top = opts.top;
  if (!Number.isInteger(top) || top < 1) throw new RangeError("top must be a positive integer");
  const reader = stream.getReader();
  const re = new RegExp(ROW.source, "g");
  let buf = "";
  let rows = 0;
  let byVol: Row[] = [];
  let byVal: Row[] = [];
  const trim = () => {
    byVol = byVol.sort((x, y) => y.m - x.m).slice(0, top);
    byVal = byVal.sort((x, y) => y.v - x.v).slice(0, top);
  };
  for (;;) {
    const { done, value } = await reader.read();
    if (value) buf += value;
    re.lastIndex = 0;
    let last = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(buf))) {
      rows++;
      const row = { a: m[1]!.toLowerCase(), v: Number(m[2]), m: Number(m[3]) };
      if (Number.isFinite(row.v) && Number.isFinite(row.m)) {
        byVol.push(row);
        byVal.push(row);
      }
      last = re.lastIndex;
    }
    buf = buf.slice(last);
    if (buf.length > 2 * MAX_ROW) buf = buf.slice(-MAX_ROW);
    if (byVol.length > Math.max(4000, 4 * top)) trim();
    if (done) break;
  }
  trim();
  const min = opts.minRows ?? top;
  if (rows < min)
    throw new LeaderboardError(`Leaderboard format not recognised (${rows} rows, expected at least ${min})`);
  const toAccount = (x: Row, i: number): RankedAccount => ({
    a: x.a,
    rank: i + 1,
    accountValue: x.v,
    monthVolume: x.m,
  });
  return { rows, volume: byVol.map(toAccount), value: byVal.map(toAccount) };
}

export type FetchLeaderboardOptions = { fetch?: FetchLike; url?: string; timeoutMs?: number };

/** Opens the leaderboard as a text stream. */
export async function fetchLeaderboard(opts: FetchLeaderboardOptions = {}): Promise<ReadableStream<string>> {
  const doFetch: FetchLike = opts.fetch ?? ((input, init) => fetch(input, init));
  const r = await doFetch(opts.url ?? LEADERBOARD_URL, { signal: AbortSignal.timeout(opts.timeoutMs ?? 25_000) });
  if (!r.ok || !r.body) throw new LeaderboardError(`Leaderboard responded ${r.status}`);
  return r.body.pipeThrough(new TextDecoderStream());
}
