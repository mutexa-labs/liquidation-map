// Records the fixtures for the tests from the live public sources.
//
//   pnpm record [rows] [states]
//
// Writes fixtures/leaderboard.json: the first `rows` rows of Hyperliquid's leaderboard file, byte-for-byte in the
// file's own formatting, with every address replaced by an obviously fake one and display names removed; and
// fixtures/states.json: the public clearinghouseState of the top `states` accounts by 30-day volume within those
// rows (positions trimmed to the fields the map reads), plus allMids for the coins they hold.

import { writeFileSync } from "node:fs";
import { HL_INFO_URL } from "@mutexa/venue-adapters";
import { LEADERBOARD_URL } from "../src/leaderboard";

const ROWS = Number(process.argv[2] ?? 120);
const STATES = Number(process.argv[3] ?? 8);
const fake = (i: number) => `0x${(0xc001 + i).toString(16).padStart(40, "0")}`;

const text = await (await fetch(LEADERBOARD_URL)).text();
const starts: number[] = [];
const marker = /\n\s*\{\s*\n\s*"ethAddress"/g;
let m: RegExpExecArray | null;
while ((m = marker.exec(text)) && starts.length <= ROWS) starts.push(m.index);
if (starts.length <= ROWS) throw new Error("leaderboard has fewer rows than requested");
let body = text.slice(0, starts[ROWS]!).replace(/,\s*$/, "") + "\n  ]\n}\n";

const rows = (
  JSON.parse(body) as { leaderboardRows: { ethAddress: string; windowPerformances: [string, { vlm: string }][] }[] }
).leaderboardRows;
const real = rows.map((r) => r.ethAddress.toLowerCase());
const byVol = [...rows]
  .sort((x, y) => Number(y.windowPerformances[2]![1].vlm) - Number(x.windowPerformances[2]![1].vlm))
  .slice(0, STATES)
  .map((r) => r.ethAddress.toLowerCase());

const info = async (b: unknown) =>
  (await (
    await fetch(HL_INFO_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(b),
    })
  ).json()) as any;

const exchanges: { request: unknown; response: unknown }[] = [];
const coins = new Set<string>();
for (const a of byVol) {
  const st = await info({ type: "clearinghouseState", user: a });
  const assetPositions = st.assetPositions.map(({ type, position: p }: any) => {
    coins.add(p.coin);
    return {
      type,
      position: {
        coin: p.coin,
        szi: p.szi,
        leverage: { type: p.leverage.type, value: p.leverage.value },
        entryPx: p.entryPx,
        positionValue: p.positionValue,
        liquidationPx: p.liquidationPx,
      },
    };
  });
  exchanges.push({ request: { type: "clearinghouseState", user: a }, response: { assetPositions, time: st.time } });
}
const mids = await info({ type: "allMids" });
exchanges.push({
  request: { type: "allMids" },
  response: Object.fromEntries(Object.entries(mids).filter(([k]) => coins.has(k))),
});

let states = JSON.stringify(
  {
    recordedAt: new Date().toISOString(),
    recordedWith: "scripts/record.ts",
    note: "Public Hyperliquid responses, trimmed to the fields the map reads. Account addresses are fake.",
    accounts: byVol,
    exchanges,
  },
  null,
  1,
);
body = body.replace(/"displayName":\s*"[^"]*"/g, '"displayName": null');
real.forEach((a, i) => {
  body = body.split(a).join(fake(i));
  body = body.split(rows[i]!.ethAddress).join(fake(i));
  states = states.split(a).join(fake(i));
});
if (/0x[0-9a-fA-F]{40}/.test(body.replace(/0x0{35}[0-9a-f]{5}/g, "")))
  throw new Error("a real address survived in the leaderboard");
writeFileSync("fixtures/leaderboard.json", body);
writeFileSync("fixtures/states.json", states + "\n");
console.error(`wrote ${ROWS} leaderboard rows and ${byVol.length} account states`);
