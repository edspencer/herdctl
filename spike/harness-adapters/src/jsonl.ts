/**
 * Strict LF-only JSONL framing.
 *
 * WHY NOT node:readline -- and an honest correction.
 *
 * Pi's docs (docs/rpc.md, docs/json.md, and the jsonl.d.ts source comment)
 * warn three separate times against using readline for its RPC stream, giving
 * a specific reason: readline also treats U+2028 (LINE SEPARATOR) and U+2029
 * (PARAGRAPH SEPARATOR) as line terminators, and both are legal UNESCAPED
 * inside a JSON string, so a record containing one would be split mid-object.
 *
 * THAT DOES NOT REPRODUCE on the Node this spike ran (v22.23.5). Measured
 * directly in scripts/probe-readline.ts: readline splits "a b" into ONE
 * line, not two, and likewise for U+2029 and U+0085. So the documented hazard
 * is either stale, or aimed at a different runtime or an older Node. Recorded
 * as a corrected claim rather than repeated as fact -- the brief asked for the
 * harnesses' docs to be treated as leads and verified against the installed
 * versions, and this is one that did not survive verification.
 *
 * This module is still what both adapters use, for reasons that DO hold:
 *   - It is explicit about the framing contract instead of inheriting whatever
 *     a given Node version's readline considers a line, which is exactly the
 *     kind of silent cross-version drift a long-lived adapter should not carry.
 *   - It surfaces malformed lines to a callback instead of swallowing them,
 *     which matters because harnesses emit non-protocol noise on the same pipe.
 *   - It decodes with StringDecoder, so a UTF-8 sequence split across a chunk
 *     boundary survives (verified in scripts/test-jsonl.ts).
 */

import { StringDecoder } from "node:string_decoder";
import type { Readable } from "node:stream";

/**
 * Read a stream as LF-delimited JSON records.
 *
 * Splits on \n ONLY (stripping an optional trailing \r). Malformed lines are
 * passed to `onParseError` rather than thrown, because a harness may emit
 * non-protocol log noise on the same pipe.
 */
export function readJsonLines(
  stream: Readable,
  onRecord: (value: unknown, rawLine: string) => void,
  onParseError?: (line: string, err: unknown) => void,
): void {
  const decoder = new StringDecoder("utf8");
  let buffer = "";

  stream.on("data", (chunk: Buffer) => {
    buffer += decoder.write(chunk);
    let idx: number;
    // Deliberately indexOf("\n"), never a regex with \s or Unicode classes.
    while ((idx = buffer.indexOf("\n")) !== -1) {
      let line = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 1);
      if (line.endsWith("\r")) line = line.slice(0, -1);
      if (line.trim() === "") continue;
      try {
        onRecord(JSON.parse(line), line);
      } catch (err) {
        onParseError?.(line, err);
      }
    }
  });

  stream.on("end", () => {
    const tail = buffer + decoder.end();
    const line = tail.endsWith("\r") ? tail.slice(0, -1) : tail;
    if (line.trim() === "") return;
    try {
      onRecord(JSON.parse(line), line);
    } catch (err) {
      onParseError?.(line, err);
    }
  });
}

/** Serialize one record. LF only; never \r\n. */
export function writeJsonLine(stream: { write: (s: string) => unknown }, value: unknown): void {
  stream.write(`${JSON.stringify(value)}\n`);
}
