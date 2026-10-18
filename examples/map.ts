// pnpm exec tsx examples/map.ts
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
