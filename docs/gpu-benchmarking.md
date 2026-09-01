# GPU benchmarking

The benchmark is intentionally reproducible and opt-in. It uses the deterministic bundled sphere, Fast resolution 64, no smoothing, no decimation, and the **WebGPU required** backend. A failed adapter request, device loss, limit violation, shader error, or CPU validation mismatch is reported instead of silently producing a GPU result.

1. Open the live app in the browser and OS you want to test.
2. Select **Run reproducible WebGPU benchmark**.
3. After Ready, select **Benchmark JSON**.
4. Review the JSON. It contains the browser user-agent, reported logical CPU concurrency, adapter information exposed by WebGPU, parameters, timings, validation deltas, and topology counts. It contains no source asset bytes.
5. Attach it to a **GPU compatibility report** issue if you consent to sharing those fields.

Reports are never uploaded automatically. Maintainers review contributed results before adding JSON to `benchmarks/results`. `npm run benchmark:summary` renders only those reviewed files; an empty table is preferable to invented or unverified performance claims.

The compute timing includes queue completion and buffer copy submission. Readback mapping is reported separately. Browser, driver, power state, thermal state, and background work affect results, so the table is compatibility evidence rather than a universal ranking.
