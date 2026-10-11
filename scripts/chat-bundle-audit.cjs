const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

const dir = path.join("apps/desktop", "dist", "assets");
const files = fs.readdirSync(dir).filter((f) => f.endsWith(".js"));
const imports = {};
for (const f of files) {
  const src = fs.readFileSync(path.join(dir, f), "utf8");
  const set = new Set();
  const re = /from["'](\.\/[^"']+\.js)["']/g;
  let m;
  while ((m = re.exec(src)) !== null) {
    set.add(m[1].slice(2));
  }
  imports[f] = [...set];
}
const html = fs.readFileSync(
  path.join("apps/desktop", "dist", "index.html"),
  "utf8",
);
const entries = [...html.matchAll(/assets\/(index-[A-Za-z0-9_-]+\.js)/g)].map(
  (m) => m[1],
);
console.log("entries:", entries);
const gz = (f) => zlib.gzipSync(fs.readFileSync(path.join(dir, f))).length;
const seen = new Set();
const closure = (roots) => {
  for (const f of roots) {
    if (seen.has(f)) continue;
    seen.add(f);
    closure(imports[f] || []);
  }
};
closure(entries);
let t = 0;
for (const f of seen) t += gz(f);
console.log(
  "initial-load files:",
  seen.size,
  "gzip total:",
  (t / 1024).toFixed(1) + "KiB",
);
for (const f of [...seen].sort())
  console.log("  " + f + " " + (gz(f) / 1024).toFixed(1) + "KiB");

// Chat chunk: dynamic import targets of the entry.
const entrySrc = fs.readFileSync(path.join(dir, entries[0]), "utf8");
const dynTargets = new Set();
{
  const re = /import\(["'](\.\/[^"']+\.js)["']\)/g;
  let m;
  while ((m = re.exec(entrySrc)) !== null) dynTargets.add(m[1].slice(2));
  const mapRe = /"assets\/([A-Za-z0-9_.-]+\.js)"/g;
  while ((m = mapRe.exec(entrySrc)) !== null) dynTargets.add(m[1]);
}
console.log("entry dynamic targets:", [...dynTargets]);
const roots = process.argv.slice(2);
if (roots.length === 0) {
  console.log("usage: node scripts/chat-bundle-audit.cjs <chunk...>");
  process.exit(1);
}
console.log("roots:", roots);
if (roots[0]) {
  const cseen = new Set();
  const c2 = (roots) => {
    for (const f of roots) {
      if (seen.has(f) || cseen.has(f)) continue;
      cseen.add(f);
      c2(imports[f] || []);
    }
  };
  c2(roots);
  let ct = 0;
  for (const f of cseen) ct += gz(f);
  console.log(
    "closure files:",
    cseen.size,
    "gzip total:",
    (ct / 1024).toFixed(1) + "KiB",
  );
  const big = [...cseen].sort((a, b) => gz(b) - gz(a)).slice(0, 15);
  for (const f of big)
    console.log("  " + f + " " + (gz(f) / 1024).toFixed(1) + "KiB");
}
