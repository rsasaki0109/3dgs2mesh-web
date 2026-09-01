import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const out = resolve(root, "src/wasm");
mkdirSync(out, { recursive: true });
const cargoBin = join(
  homedir(),
  ".cargo",
  "bin",
  process.platform === "win32" ? "wasm-pack.exe" : "wasm-pack",
);
const wasmPack = existsSync(cargoBin) ? cargoBin : "wasm-pack";
const env = {
  ...process.env,
  PATH: `${join(homedir(), ".cargo", "bin")}${delimiter}${process.env.PATH ?? ""}`,
};

execFileSync(
  wasmPack,
  [
    "build",
    "crates/mesh-wasm",
    "--target",
    "web",
    "--release",
    "--out-dir",
    resolve(root, "src/wasm"),
  ],
  { cwd: root, env, stdio: "inherit" },
);
