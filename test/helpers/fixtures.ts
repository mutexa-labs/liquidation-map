import { readFileSync } from "node:fs";
import type { HlClearinghouseState } from "@mutexa/venue-adapters";
import { fixtureFetch, type HttpExchange } from "@mutexa/venue-adapters/conformance";
import { LEADERBOARD_URL } from "../../src/leaderboard";

const path = (p: string) => new URL(`../../fixtures/${p}`, import.meta.url);

/** The recorded leaderboard text (first rows of the real file, fake addresses). */
export const leaderboardText = readFileSync(path("leaderboard.json"), "utf8");
export const states = JSON.parse(readFileSync(path("states.json"), "utf8")) as {
  recordedAt: string;
  accounts: string[];
  exchanges: HttpExchange[];
};

export function stateOf(a: string): HlClearinghouseState {
  return states.exchanges.find((e) => (e.request as { user?: string }).user === a)!.response as HlClearinghouseState;
}

/** A text stream that delivers `text` cut at the given offsets. */
export function chunked(text: string, cuts: number[]): ReadableStream<string> {
  const points = [0, ...[...new Set(cuts)].filter((c) => c > 0 && c < text.length).sort((a, b) => a - b), text.length];
  const parts = points.slice(1).map((end, i) => text.slice(points[i], end));
  return new ReadableStream({
    pull(c) {
      const next = parts.shift();
      if (next === undefined) c.close();
      else c.enqueue(next);
    },
  });
}

/** Seeded chunk sizes between 1 and `max`. */
export function randomCuts(length: number, seed: number, max: number): number[] {
  let s = seed;
  const r = () => (s = (s * 16807) % 2147483647) / 2147483647;
  const cuts: number[] = [];
  for (let at = 0; at < length;) cuts.push((at += 1 + Math.floor(r() * max)));
  return cuts;
}

/** A fetch that serves the recorded leaderboard (in awkward chunks) and the recorded info responses. */
export function fakeFetch(opts: { leaderboard?: string } = {}) {
  const info = fixtureFetch(states.exchanges);
  const text = opts.leaderboard ?? leaderboardText;
  const bytes = new TextEncoder().encode(text);
  const f = async (url: string, init?: RequestInit) => {
    if (url === LEADERBOARD_URL) {
      const cuts = randomCuts(bytes.length, 7, 3000);
      const pts = [0, ...cuts.filter((c) => c < bytes.length), bytes.length];
      const body = new ReadableStream<Uint8Array>({
        start(c) {
          for (let i = 1; i < pts.length; i++) c.enqueue(bytes.slice(pts[i - 1], pts[i]));
          c.close();
        },
      });
      return new Response(body, { status: 200 });
    }
    return info(url, init);
  };
  return Object.assign(f, { calls: info.calls });
}
