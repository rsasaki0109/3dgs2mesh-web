import { formatBytes } from "../conversion/params";
import type { DensityStats, ParseReport } from "../types/model";

interface Props {
  fileSize: number;
  report?: ParseReport;
  dims?: [number, number, number];
  voxelCount?: number;
  gridMemory?: number;
  density?: DensityStats;
  vertexCount?: number;
  triangleCount?: number;
  elapsed?: Record<string, number>;
  backendUsed?: "webgpu" | "wasm";
}
const elapsedLabel = (ms?: number) =>
  ms === undefined
    ? "—"
    : ms < 1000
      ? `${Math.round(ms)} ms`
      : `${(ms / 1000).toFixed(2)} s`;
export function StatsPanel({
  fileSize,
  report,
  dims,
  voxelCount,
  gridMemory,
  density,
  vertexCount,
  triangleCount,
  elapsed,
  backendUsed,
}: Props) {
  return (
    <div className="stats-panel">
      <div className="stats-grid">
        <Stat label="Source file" value={formatBytes(fileSize)} />
        <Stat
          label="Density backend"
          value={
            backendUsed === "webgpu"
              ? "WebGPU"
              : backendUsed === "wasm"
                ? "CPU / WASM"
                : "—"
          }
        />
        <Stat
          label="Source Gaussians"
          value={report?.inputCount.toLocaleString() ?? "—"}
        />
        <Stat
          label="Retained"
          value={report?.retainedCount.toLocaleString() ?? "—"}
        />
        <Stat label="Grid" value={dims ? dims.join(" × ") : "—"} />
        <Stat label="Voxels" value={voxelCount?.toLocaleString() ?? "—"} />
        <Stat
          label="Grid memory"
          value={gridMemory === undefined ? "—" : formatBytes(gridMemory)}
        />
        <Stat
          label="Density range"
          value={
            density
              ? `${density.min.toPrecision(3)} — ${density.max.toPrecision(3)}`
              : "—"
          }
        />
        <Stat
          label="Mesh vertices"
          value={vertexCount?.toLocaleString() ?? "—"}
        />
        <Stat
          label="Triangles"
          value={triangleCount?.toLocaleString() ?? "—"}
        />
      </div>
      {elapsed && (
        <div className="elapsed-list">
          <span>Stage timings</span>
          <small>
            parse {elapsedLabel(elapsed.parsing)} · voxelize{" "}
            {elapsedLabel(elapsed.voxelizing)} · mesh{" "}
            {elapsedLabel(elapsed.extracting)} · cleanup{" "}
            {elapsedLabel(elapsed.cleaning)}
          </small>
        </div>
      )}
    </div>
  );
}
function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="stat">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}
