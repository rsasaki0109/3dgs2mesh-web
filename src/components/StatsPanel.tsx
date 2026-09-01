import { formatBytes } from "../conversion/params";
import type {
  DensityStats,
  GpuInfo,
  MeshQuality,
  ParseReport,
} from "../types/model";

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
  backendUsed?: "webgpu" | "wasm" | "cpu-streaming";
  backendTimings?: { indexing: number; compute: number; readback: number };
  validation?: {
    samples: number;
    maxAbsError: number;
    maxRelativeError: number;
  };
  quality?: MeshQuality;
  gpuInfo?: GpuInfo;
  lowMemoryUsed?: boolean;
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
  backendTimings,
  validation,
  quality,
  gpuInfo,
  lowMemoryUsed,
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
                : backendUsed === "cpu-streaming"
                  ? "CPU streaming slabs"
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
        <Stat
          label="Boundary edges"
          value={quality?.boundaryEdges.toLocaleString() ?? "—"}
        />
        <Stat
          label="Non-manifold edges"
          value={quality?.nonManifoldEdges.toLocaleString() ?? "—"}
        />
        <Stat
          label="Components"
          value={quality?.components.toLocaleString() ?? "—"}
        />
        <Stat
          label="Degenerate faces"
          value={quality?.degenerateFaces.toLocaleString() ?? "—"}
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
      {backendTimings && (
        <div className="elapsed-list">
          <span>WebGPU timings</span>
          <small>
            bins {elapsedLabel(backendTimings.indexing)} · compute{" "}
            {elapsedLabel(backendTimings.compute)} · readback{" "}
            {elapsedLabel(backendTimings.readback)}
            {validation
              ? ` · ${validation.samples} checks · max Δ ${validation.maxAbsError.toPrecision(2)}`
              : ""}
          </small>
        </div>
      )}
      {quality &&
        (quality.preDecimationVertices !== vertexCount ||
          quality.preDecimationTriangles !== triangleCount) && (
          <div className="elapsed-list">
            <span>Decimation</span>
            <small>
              {quality.preDecimationVertices.toLocaleString()} →{" "}
              {vertexCount?.toLocaleString()} vertices ·{" "}
              {quality.preDecimationTriangles.toLocaleString()} →{" "}
              {triangleCount?.toLocaleString()} triangles
            </small>
          </div>
        )}
      {quality &&
        (quality.denoisedVoxels > 0 ||
          quality.enclosedVoxelsFilled > 0 ||
          quality.holesFilled > 0) && (
          <div className="elapsed-list">
            <span>Repair</span>
            <small>
              {quality.denoisedVoxels.toLocaleString()} denoised voxels ·{" "}
              {quality.enclosedVoxelsFilled.toLocaleString()} enclosed voxels ·{" "}
              {quality.holesFilled.toLocaleString()} capped holes
            </small>
          </div>
        )}
      {(gpuInfo || lowMemoryUsed) && (
        <div className="elapsed-list">
          <span>{lowMemoryUsed ? "Low-memory slabs" : "GPU adapter"}</span>
          <small>
            {lowMemoryUsed
              ? `peak density ${formatBytes(quality?.peakDensityBytes ?? 0)}`
              : [gpuInfo?.vendor, gpuInfo?.architecture, gpuInfo?.device]
                  .filter(Boolean)
                  .join(" · ") || "Adapter details unavailable"}
          </small>
        </div>
      )}
      {quality &&
        (quality.preCleanupVertices !== quality.preDecimationVertices ||
          quality.preCleanupTriangles !== quality.preDecimationTriangles) && (
          <div className="elapsed-list">
            <span>Cleanup</span>
            <small>
              {quality.preCleanupVertices.toLocaleString()} →{" "}
              {quality.preDecimationVertices.toLocaleString()} vertices ·{" "}
              {quality.preCleanupTriangles.toLocaleString()} →{" "}
              {quality.preDecimationTriangles.toLocaleString()} triangles
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
