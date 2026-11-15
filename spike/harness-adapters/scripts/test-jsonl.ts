/**
 * Proves the readline hazard is real rather than theoretical, by feeding the
 * SAME bytes to node:readline and to our strict splitter.
 */
import { Readable } from "node:stream";
import { createInterface } from "node:readline";
import { readJsonLines } from "../src/jsonl.ts";

// A realistic record: assistant text containing U+2028, legal unescaped in JSON.
const payload = { method: "item/agentMessage/delta", params: { delta: "line one line two" } };
const bytes = Buffer.from(JSON.stringify(payload) + "\n", "utf8");

const mk = () => Readable.from([bytes]);

// --- readline ---
const rlLines: string[] = [];
await new Promise<void>((res) => {
  const rl = createInterface({ input: mk() });
  rl.on("line", (l) => rlLines.push(l));
  rl.on("close", () => res());
});
let rlOk = 0, rlFail = 0;
for (const l of rlLines) { try { JSON.parse(l); rlOk++; } catch { rlFail++; } }
console.log(`node:readline     -> ${rlLines.length} line(s), ${rlOk} parsed, ${rlFail} FAILED to parse`);

// --- strict splitter ---
const recs: unknown[] = []; let parseErrors = 0;
await new Promise<void>((res) => {
  const s = mk();
  readJsonLines(s, (v) => recs.push(v), () => { parseErrors++; });
  s.on("end", () => setTimeout(res, 10));
});
console.log(`strict LF split   -> ${recs.length} record(s), ${parseErrors} parse error(s)`);
const got = (recs[0] as typeof payload)?.params?.delta;
console.log(`round-trip intact -> ${JSON.stringify(got)} (${got === payload.params.delta ? "IDENTICAL" : "CORRUPTED"})`);

// --- UTF-8 split across chunk boundary ---
const multi = Buffer.from(JSON.stringify({ t: "héllo→世界" }) + "\n", "utf8");
const chunks = [multi.subarray(0, 9), multi.subarray(9, 15), multi.subarray(15)];
const recs2: any[] = [];
await new Promise<void>((res) => {
  const s = Readable.from(chunks);
  readJsonLines(s, (v) => recs2.push(v));
  s.on("end", () => setTimeout(res, 10));
});
console.log(`utf8 chunk split  -> ${JSON.stringify(recs2[0]?.t)} (${recs2[0]?.t === "héllo→世界" ? "IDENTICAL" : "CORRUPTED"})`);
