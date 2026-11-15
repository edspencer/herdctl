import { Readable } from "node:stream";
import { createInterface } from "node:readline";

async function split(label: string, s: string): Promise<string[]> {
  const out: string[] = [];
  await new Promise<void>((res) => {
    const rl = createInterface({ input: Readable.from([Buffer.from(s, "utf8")]) });
    rl.on("line", (l) => out.push(l));
    rl.on("close", () => res());
  });
  console.log(`${label.padEnd(26)} -> ${out.length} line(s): ${JSON.stringify(out)}`);
  return out;
}

console.log(`node ${process.version}\n`);
await split("plain LF", "a\nb\n");
await split("U+2028 bare", "a b\n");
await split("U+2029 bare", "a b\n");
await split("U+0085 NEL", "a\u0085b\n");
await split("U+2028 inside json str", JSON.stringify({ t: "a b" }) + "\n");
