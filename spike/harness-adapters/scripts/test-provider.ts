import { startFakeProvider } from "../src/fake-provider.ts";
const { url, close } = await startFakeProvider(8099);
const post = async (path, body) => {
  const r = await fetch(url + path, { method: "POST", headers: { "content-type": "application/json", authorization: "Bearer x" }, body: JSON.stringify(body) });
  const ct = r.headers.get("content-type") || "";
  return ct.includes("event-stream") ? await r.text() : await r.json();
};
const tools = [{ type: "function", function: { name: "write_file", parameters: { properties: { path: {}, content: {} } } } }];

console.log("--- 1. chat non-stream, tool_file => expect tool_calls");
let r = await post("/chat/completions", { model: "m", messages: [{ role: "user", content: "make a file [[SPIKE:tool_file]]" }], tools });
console.log(JSON.stringify(r.choices[0]));

console.log("\n--- 2. chat, tool result in history => expect DONE text");
r = await post("/chat/completions", { model: "m", messages: [
  { role: "user", content: "make a file [[SPIKE:tool_file]]" },
  { role: "assistant", content: null, tool_calls: [{ id: "c1", type: "function", function: { name: "write_file", arguments: "{\"path\":\"spike-alpha.txt\"}" } }] },
  { role: "tool", tool_call_id: "c1", content: "wrote spike-alpha.txt" },
], tools });
console.log(JSON.stringify(r.choices[0].message));

console.log("\n--- 3. ORACLE: recall WITH history => expect RECALLED");
r = await post("/chat/completions", { model: "m", messages: [
  { role: "user", content: "make a file" },
  { role: "tool", tool_call_id: "c1", content: "wrote spike-alpha.txt" },
  { role: "user", content: "what file? [[SPIKE:recall]]" },
], tools });
console.log(JSON.stringify(r.choices[0].message.content));

console.log("\n--- 4. ORACLE: recall WITHOUT history => expect NO_MEMORY");
r = await post("/chat/completions", { model: "m", messages: [{ role: "user", content: "what file? [[SPIKE:recall]]" }], tools });
console.log(JSON.stringify(r.choices[0].message.content));

console.log("\n--- 5. shell-only harness => expect shell tool chosen with command arg");
r = await post("/chat/completions", { model: "m", messages: [{ role: "user", content: "[[SPIKE:tool_file]]" }], tools: [{ type: "function", function: { name: "local_shell", parameters: { properties: { command: {} } } } }] });
console.log(JSON.stringify(r.choices[0].message.tool_calls[0].function));

console.log("\n--- 6. Responses API stream, tool_file => expect function_call events");
const txt = await post("/responses", { model: "m", stream: true, input: [{ role: "user", content: [{ type: "input_text", text: "[[SPIKE:tool_file]]" }] }], tools: [{ type: "function", name: "shell", parameters: { properties: { command: {} } } }] });
console.log(txt.split("\n").filter(l => l.startsWith("event:")).join("\n"));

console.log("\n--- 7. Responses API, no suitable tool => expect NO_SUITABLE_TOOL");
r = await post("/responses", { model: "m", input: [{ role: "user", content: [{ type: "input_text", text: "[[SPIKE:mcp]]" }] }], tools: [] });
console.log(JSON.stringify(r.output[0].content[0].text));
close();
