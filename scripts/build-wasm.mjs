import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const out = resolve(root, "src/wasm");
mkdirSync(out, { recursive: true });

execFileSync(
  "wasm-pack",
  [
    "build",
    "crates/mesh-wasm",
    "--target",
    "web",
    "--release",
    "--out-dir",
    resolve(root, "src/wasm"),
  ],
  { cwd: root, stdio: "inherit" },
);
