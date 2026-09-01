# Contributing

Thanks for helping make browser-local 3DGS tooling practical.

1. Install current Node.js and Rust, then `rustup target add wasm32-unknown-unknown` and `cargo install wasm-pack`.
2. Run `npm install`, `npm run dev`, and `npm run check`.
3. Keep parser and geometry behavior deterministic and document mathematical changes in `docs/algorithm.md`.
4. Add focused Rust/Vitest coverage. Use the synthetic sample for smoke tests; do not commit third-party or private assets.
5. Avoid network calls, analytics, and code copied from incompatible research repositories.

Pull requests should explain user-visible behavior, memory implications, and which checks were run. Please report security issues privately as described in `SECURITY.md`.
