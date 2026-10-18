import { describe, expect, it } from "vitest";
import { parseMapQuery, partOf, rankLeaderboard } from "../src/index";
import { chunked, leaderboardText } from "./helpers/fixtures";

describe("parts", () => {
  it("slices a ranking into consecutive parts with no overlap", async () => {
    const r = await rankLeaderboard(chunked(leaderboardText, []), { top: 30 });
    const parts = [0, 1, 2].map((i) => partOf(r, "volume", i, 10));
    expect(parts.flat()).toEqual(r.volume);
    expect(parts.map((p) => p[0]!.rank)).toEqual([1, 11, 21]);
    expect(partOf(r, "value", 3, 10)).toEqual([]);
  });

  it("parses the query", () => {
    expect(parseMapQuery({}, 3)).toEqual({ ok: true, rank: "volume", part: 0 });
    expect(parseMapQuery({ rank: "value", part: "2" }, 3)).toEqual({ ok: true, rank: "value", part: 2 });
    expect(parseMapQuery({ rank: "pnl" }, 3)).toMatchObject({ ok: false });
    expect(parseMapQuery({ part: "3" }, 3)).toEqual({ ok: false, error: "part must be an integer from 0 to 2" });
    expect(parseMapQuery({ part: "1.5" }, 3)).toMatchObject({ ok: false });
  });
});
