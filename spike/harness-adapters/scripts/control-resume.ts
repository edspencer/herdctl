/**
 * NEGATIVE CONTROL for the resume oracle.
 *
 * S3 passing only means something if the same test FAILS when resume cannot
 * work. Here we resume a session id that never existed. Pi's --session-id
 * creates-on-miss (warning only on stderr), so the process starts happily and
 * a naive "did it error?" check would call this a pass. The oracle should say
 * NO_MEMORY.
 */
import { startFakeProvider } from "../src/fake-provider.ts";
import { PiAdapter } from "../src/pi-adapter.ts";
import { collectUntil, printEvent } from "../src/scenarios.ts";
import { mkdirSync } from "node:fs";

const provider = await startFakeProvider(8099);
const cwd = "/data/paddock-servers/harness-spike/work/control-resume";
mkdirSync(cwd, { recursive: true });
const adapter = new PiAdapter();
const session = await adapter.startSession({
  cwd,
  model: "spike-fake-1",
  resumeSessionId: "00000000-dead-beef-0000-000000000000", // never existed
  env: { SPIKE_PROVIDER_URL: provider.url },
});
const collector = collectUntil(session, (e) => e.type === "turn_end", 60000, printEvent);
await session.prompt("Which spike file did you create earlier? [[SPIKE:recall]]");
const { events } = await collector;
const text = events.filter((e) => e.type === "assistant_text").map((e: any) => e.text).join("");
console.log(`\ncontrol verdict: ${text.includes("NO_MEMORY") ? "NO_MEMORY as expected -- oracle discriminates" : `UNEXPECTED: ${text}`}`);
await session.close();
provider.close();
process.exit(0);
