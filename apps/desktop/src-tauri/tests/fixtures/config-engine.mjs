// Deterministic newline JSON-RPC peer for the production Rust sidecar driver.
import { createInterface } from "node:readline";
import { appendFileSync } from "node:fs";
const [log, scenario = "ok"] = process.argv.slice(2);
let runtime = "unknown";
for await (const line of createInterface({ input: process.stdin })) {
  const request = JSON.parse(line);
  const { id, method, params } = request;
  appendFileSync(log, JSON.stringify({ method, params }) + "\n");
  if (method === "session/delete" && scenario === "silent-delete") continue;
  let result = {};
  if (method === "client/connect") runtime = params.runtime;
  if (method === "session/open") {
    if (scenario === "open-failure") {
      process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id, error: { code: -32003, message: "fixture open failed" } }) + "\n");
      continue;
    }
    result = { sessionId: `fixture-${runtime}`, modelOptions: {
      models: scenario === "empty" ? [] : [{ value: `${runtime}-model`, name: "Fixture model" }],
      current_model_id: `${runtime}-model`, current_reasoning_effort: "high",
      extra_options: [{ id: "reasoning_effort", name: "Reasoning", kind: { Select: { current: "high", options: [{ value: "low", name: "Low" }, { value: "high", name: "High" }] } } }],
    } };
  }
  if (method === "ping") result = { message: "pong" };
  process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id, result }) + "\n");
}
