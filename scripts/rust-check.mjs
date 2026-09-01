import { execFileSync } from "node:child_process";

const commands = [
  ["cargo", ["fmt", "--all", "--", "--check"]],
  ["cargo", ["clippy", "--workspace", "--all-targets", "--", "-D", "warnings"]],
  ["cargo", ["test", "--workspace"]],
];
for (const [command, args] of commands) {
  try {
    execFileSync(command, args, { stdio: "inherit" });
  } catch (error) {
    if (error?.code === "ENOENT") {
      console.warn(
        "Rust toolchain is not installed; Rust checks are deferred to CI.",
      );
      process.exit(0);
    }
    process.exit(typeof error?.status === "number" ? error.status : 1);
  }
}
