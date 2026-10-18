import { describe, expect, it } from "vitest";
import { LeaderboardError, rankLeaderboard, type Ranking } from "../src/index";
import { chunked, leaderboardText, randomCuts } from "./helpers/fixtures";

type Row = { ethAddress: string; accountValue: string; windowPerformances: [string, { vlm: string }][] };
const rows = (JSON.parse(leaderboardText) as { leaderboardRows: Row[] }).leaderboardRows;

/** Reference ranking from a full JSON.parse, which the streaming ranker must reproduce exactly. */
function reference(top: number): Ranking {
  const all = rows.map((r) => ({
    a: r.ethAddress.toLowerCase(),
    v: Number(r.accountValue),
    m: Number(r.windowPerformances.find((w) => w[0] === "month")![1].vlm),
  }));
  const toAcc = (x: (typeof all)[number], i: number) => ({ a: x.a, rank: i + 1, accountValue: x.v, monthVolume: x.m });
  return {
    rows: all.length,
    volume: [...all]
      .sort((x, y) => y.m - x.m)
      .slice(0, top)
      .map(toAcc),
    value: [...all]
      .sort((x, y) => y.v - x.v)
      .slice(0, top)
      .map(toAcc),
  };
}

/** Offsets that cut through the middle of a row: inside the key, the address, and the 30-day volume. */
function nastyCuts(): number[] {
  const cuts: number[] = [];
  let at = 0;
  for (;;) {
    const k = leaderboardText.indexOf('"ethAddress"', at);
    if (k < 0) break;
    cuts.push(k + 4, k + 20);
    const month = leaderboardText.indexOf('"month"', k);
    const vlm = leaderboardText.indexOf('"vlm"', month);
    cuts.push(vlm + 2, vlm + 12);
    at = k + 1;
  }
  return cuts;
}

describe("rankLeaderboard", () => {
  const top = 25;
  const expected = reference(top);

  it("recognises every recorded row", async () => {
    const r = await rankLeaderboard(chunked(leaderboardText, []), { top });
    expect(r.rows).toBe(rows.length);
    expect(r).toEqual(expected);
  });

  it("gives the same ranking when rows are split across chunks", async () => {
    expect(await rankLeaderboard(chunked(leaderboardText, nastyCuts()), { top })).toEqual(expected);
  });

  it("gives the same ranking for tiny and random chunk sizes", async () => {
    expect(await rankLeaderboard(chunked(leaderboardText, randomCuts(leaderboardText.length, 1, 7)), { top })).toEqual(
      expected,
    );
    for (const seed of [3, 11, 42])
      expect(
        await rankLeaderboard(chunked(leaderboardText, randomCuts(leaderboardText.length, seed, 5000)), { top }),
      ).toEqual(expected);
  });

  it("sorts an unsorted file", async () => {
    const reversed = JSON.stringify({ leaderboardRows: [...rows].reverse() }, null, 2);
    expect(await rankLeaderboard(chunked(reversed, randomCuts(reversed.length, 5, 900)), { top })).toEqual(expected);
  });

  it("ranks by volume and by value independently", async () => {
    const r = await rankLeaderboard(chunked(leaderboardText, []), { top: 10 });
    for (let i = 1; i < 10; i++) {
      expect(r.volume[i - 1]!.monthVolume).toBeGreaterThanOrEqual(r.volume[i]!.monthVolume);
      expect(r.value[i - 1]!.accountValue).toBeGreaterThanOrEqual(r.value[i]!.accountValue);
    }
    expect(r.volume.map((x) => x.rank)).toEqual(Array.from({ length: 10 }, (_, i) => i + 1));
  });

  it("fails loudly when fewer rows than requested are recognised", async () => {
    await expect(rankLeaderboard(chunked(leaderboardText, []), { top: rows.length + 1 })).rejects.toThrow(
      LeaderboardError,
    );
    await expect(rankLeaderboard(chunked('{"leaderboard": "moved"}', []), { top: 1 })).rejects.toThrow(
      /format not recognised \(0 rows/,
    );
    const r = await rankLeaderboard(chunked(leaderboardText, []), { top: rows.length + 50, minRows: 10 });
    expect(r.volume).toHaveLength(rows.length);
  });

  it("stays bounded on a long stream without rows", async () => {
    const junk = "x".repeat(200_000);
    await expect(rankLeaderboard(chunked(junk, randomCuts(junk.length, 9, 10_000)), { top: 1 })).rejects.toThrow(
      LeaderboardError,
    );
  });

  it("rejects a bad top", async () => {
    await expect(rankLeaderboard(chunked("", []), { top: 0 })).rejects.toThrow(RangeError);
  });
});
