#!/usr/bin/env node
// Build the ACP sidecar engine binary from @yitom/acp-client.
//
// The engine (src/sidecar/main.ts in the acp-client repo) speaks newline
// JSON-RPC over stdio; the Tauri backend spawns it as an externalBin
// sidecar (`bin/acp-engine`) and translates its protocol into the
// long-standing `acp_*` Tauri commands the frontend already uses.
//
// Usage:
//   node scripts/build-acp-engine.mjs [--target <triple>]
// Env:
//   ACP_CLIENT_DIR  acp-client checkout (default: D:/project/js/acp-client)
//   ACP_ENGINE_OUT  output directory (default: apps/desktop/src-tauri/bin)
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");

function argValue(flag) {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function defaultTriple() {
  if (process.platform === "win32") return "x86_64-pc-windows-msvc";
  if (process.platform === "darwin") return "aarch64-apple-darwin";
  return "x86_64-unknown-linux-gnu";
}

function resolveSidecarEntry() {
  if (process.env.ACP_CLIENT_DIR) {
    const candidate = join(process.env.ACP_CLIENT_DIR, "src", "sidecar", "main.ts");
    if (existsSync(candidate)) return candidate;
  }
  try {
    const pkgEntry = require.resolve("@yitom/acp-client/sidecar");
    if (existsSync(pkgEntry)) return pkgEntry;
  } catch {
    // ignore
  }
  const localRepo = "D:/project/js/acp-client";
  const localEntry = join(localRepo, "src", "sidecar", "main.ts");
  if (existsSync(localEntry)) return localEntry;
  return null;
}

const outDir =
  process.env.ACP_ENGINE_OUT ??
  join(root, "apps", "desktop", "src-tauri", "bin");
const triple = argValue("--target") ?? process.env.ACP_TARGET ?? defaultTriple();
const exe = process.platform === "win32" ? ".exe" : "";
const entry = resolveSidecarEntry();
const out = join(outDir, `acp-engine-${triple}${exe}`);

if (!entry) {
  console.error(`[acp-engine] sidecar entry could not be resolved from @yitom/acp-client or local paths.`);
  console.error(`[acp-engine] please run: bun add -d @yitom/acp-client`);
  process.exit(1);
}
mkdirSync(outDir, { recursive: true });

console.log(`[acp-engine] building ${entry}`);
console.log(`[acp-engine]   -> ${out}`);
execFileSync(
  "bun",
  ["build", entry, "--compile", "--outfile", out],
  { cwd: root, stdio: "inherit" },
);
console.log("[acp-engine] done");

