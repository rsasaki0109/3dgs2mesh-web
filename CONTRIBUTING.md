# Contributing

Thanks for helping make browser-local 3DGS tooling practical.

1. Install current Node.js and Rust, then `rustup target add wasm32-unknown-unknown` and `cargo install wasm-pack`.
2. Run `npm install`, `npm run dev`, and `npm run check`.
3. Keep parser and geometry behavior deterministic and document mathematical changes in `docs/algorithm.md`.
4. Add focused Rust/Vitest coverage. Use the synthetic sample for smoke tests; do not commit third-party or private assets.
5. Avoid network calls, analytics, and code copied from incompatible research repositories.

For reconstruction changes, run the opt-in browser quality harness described in [`docs/quality-validation.md`](docs/quality-validation.md) against a local asset when its license permits. For WebGPU compatibility work, use the in-app fixed benchmark and attach its JSON through the GPU compatibility issue template; do not hand-edit or invent device results. Reviewed reports can be summarized with `npm run benchmark:summary`.

Pull requests should explain user-visible behavior, memory implications, and which checks were run. Note whether resident-density and low-memory slab modes were both exercised. Please report security issues privately as described in `SECURITY.md`.
