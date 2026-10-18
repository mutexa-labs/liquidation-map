// Live smoke test against Hyperliquid. Skipped unless LIVE=1; never part of CI.
import { describe, expect, it } from "vitest";
import { buildLiquidationMap } from "../src/index";

describe.skipIf(process.env.LIVE !== "1")("live", () => {
  it("maps BTC from a small sample", async () => {
    const m = await buildLiquidationMap({
      coin: "BTC",
      rank: "volume",
      top: 8,
      range: 0.25,
      buckets: 20,
      concurrency: 4,
      budget: 16,
    });
    expect(m.leaderboardRows).toBeGreaterThan(8);
    expect(m.map.total).toBeCloseTo(m.map.inRange + m.map.outside + m.map.noLiq, 6);
  }, 60_000);
});
