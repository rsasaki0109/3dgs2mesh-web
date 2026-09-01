import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const directory = resolve(root, "benchmarks/results");
const rows = [];
for (const file of readdirSync(directory)
  .filter((name) => name.endsWith(".json"))
  .sort()) {
  const report = JSON.parse(readFileSync(resolve(directory, file), "utf8"));
  if (report.schema !== "3dgs2mesh-web/benchmark-v1")
    throw new Error(`${file}: unsupported benchmark schema`);
  rows.push([
    report.gpu?.vendor ?? "Unknown",
    report.gpu?.device ?? report.gpu?.architecture ?? "Unreported",
    report.result.backend,
    report.result.dims.join("×"),
    Math.round(report.result.backendTimingsMs?.compute ?? 0),
    Number(report.result.validation?.maxAbsError ?? 0).toExponential(2),
    file,
  ]);
}
console.log(
  "| Vendor | Device | Backend | Grid | Compute ms | Max abs Δ | Report |",
);
console.log("|---|---|---:|---:|---:|---:|---|");
for (const row of rows) console.log(`| ${row.join(" | ")} |`);
if (!rows.length)
  console.log("| — | No reviewed reports yet | — | — | — | — | — |");
