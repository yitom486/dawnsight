// A real ACP stdio Agent fixture: raw configOptions, no login/network/model calls.
import { createInterface } from "node:readline";
import { appendFileSync } from "node:fs";
const [log] = process.argv.slice(2);
let model = "fixture-model";
let effort = "high";
function configOptions() {
  const levels = model === "fixture-model-3" ? [] : model === "fixture-model-2" ? ["medium", "max"] : ["low", "high"];
  return [
    { id: "model", name: "Model", category: "model", type: "select", currentValue: model,
      options: ["fixture-model", "fixture-model-2", "fixture-model-3"].map((value) => ({ value, name: value })) },
    ...(levels.length ? [{ id: model === "fixture-model-2" ? "effort" : "variant", name: "Thinking variant", category: "thought_level", type: "select", currentValue: effort,
      options: levels.map((value) => ({ value, name: value })) }] : []),
  ];
}
for await (const line of createInterface({ input: process.stdin })) {
  const { id, method, params } = JSON.parse(line);
  appendFileSync(log, JSON.stringify({ method, params }) + "\n");
  if (id === undefined) continue;
  let result = {};
  if (method === "initialize") result = { protocolVersion: 1, agentInfo: { name: "fixture", version: "1" }, agentCapabilities: { loadSession: false }, authMethods: [] };
  if (method === "session/new") result = { sessionId: "raw-acp-config-fixture", configOptions: configOptions() };
  if (method === "session/set_config_option") {
    const option = configOptions().find((option) => option.id === params.configId);
    if (!option?.options.some((entry) => entry.value === params.value)) {
      process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id, error: { code: -32602, message: "fixture rejects unadvertised config" } }) + "\n");
      continue;
    }
    if (params.configId === "model") { model = params.value; effort = model === "fixture-model-2" ? "medium" : "high"; }
    else if (params.configId === "variant" || params.configId === "effort") effort = params.value;
    result = { configOptions: configOptions() };
  }
  process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id, result }) + "\n");
}
