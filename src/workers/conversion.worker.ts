import { parsePly } from "../conversion/ply";
import type {
  ConversionParams,
  DensityStats,
  MeshData,
  ParseReport,
  WorkerRequest,
} from "../types/model";
import initWasm, { ConversionSession } from "../wasm/mesh_wasm.js";

interface WasmDensityStats extends DensityStats {
  iso: number;
}
interface Session {
  wasm: ConversionSession;
  report: ParseReport;
  density: WasmDensityStats;
  dims: [number, number, number];
  voxelCount: number;
  gridMemory: number;
  elapsed: Record<string, number>;
}

let session: Session | undefined;
let wasmReady: Promise<unknown> | undefined;
const stageNames = [
  "parsing",
  "activating",
  "indexing",
  "voxelizing",
  "extracting",
  "cleaning",
  "normals",
  "ready",
] as const;

function progress(
  id: number,
  stage: string,
  percent: number,
  detail?: string,
  elapsed?: number,
) {
  const stageIndex = Math.max(
    0,
    stageNames.indexOf(stage as (typeof stageNames)[number]),
  );
  self.postMessage({
    type: "progress",
    id,
    stage,
    percent,
    detail,
    elapsed,
    overall: (stageIndex + percent) / stageNames.length,
  });
}

function transferables(mesh: MeshData) {
  return [
    mesh.positions.buffer,
    mesh.normals.buffer,
    mesh.colors.buffer,
    mesh.indices.buffer,
  ];
}

self.onmessage = (event: MessageEvent<WorkerRequest>) => {
  const request = event.data;
  if (request.type === "cancel") return;
  void (async () => {
    try {
      if (request.type === "start") {
        session?.wasm.free();
        session = undefined;
        const elapsed: Record<string, number> = {};
        const parseStart = performance.now();
        progress(request.id, "parsing", 0, "Reading PLY header");
        const parsed = parsePly(request.bytes, request.params.opacityThreshold);
        elapsed.parsing = performance.now() - parseStart;
        progress(
          request.id,
          "activating",
          1,
          `${parsed.report.retainedCount.toLocaleString()} Gaussians retained`,
          elapsed.parsing,
        );
        wasmReady ??= initWasm();
        await wasmReady;
        progress(request.id, "indexing", 0, "Preparing Rust/WASM session");
        const wasm = new ConversionSession(
          new Uint8Array(request.bytes),
          request.params.resolution,
          request.params.opacityThreshold,
          request.params.sigmaRadius,
          request.params.boundsQuantile,
        );
        const voxelStart = performance.now();
        progress(
          request.id,
          "voxelizing",
          0,
          "Building bins and density field",
        );
        wasm.voxelize();
        elapsed.voxelizing = performance.now() - voxelStart;
        const density = JSON.parse(wasm.density_stats()) as WasmDensityStats;
        const rawDims = wasm.grid_dimensions();
        const dims: [number, number, number] = [
          rawDims[0] ?? 0,
          rawDims[1] ?? 0,
          rawDims[2] ?? 0,
        ];
        session = {
          wasm,
          report: parsed.report,
          density,
          dims,
          voxelCount: dims[0] * dims[1] * dims[2],
          gridMemory: wasm.grid_memory_bytes(),
          elapsed,
        };
        await extractAndReply(
          request.id,
          request.params,
          request.params.isoMode === "manual"
            ? request.params.isoThreshold
            : density.iso,
        );
      } else {
        if (!session)
          throw new Error("Load a PLY before changing the iso threshold");
        await extractAndReply(request.id, request.params, request.isoThreshold);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      self.postMessage({ type: "error", id: request.id, message });
    }
  })();
};

async function extractAndReply(
  id: number,
  params: ConversionParams,
  iso: number,
) {
  if (!session) throw new Error("Conversion session is not initialized");
  const extractStart = performance.now();
  progress(id, "extracting", 0, `Iso ${iso.toPrecision(4)}`);
  session.wasm.set_iso_threshold(iso);
  session.wasm.extract_mesh(
    params.keepLargestComponent,
    params.minComponentFaces,
    params.smoothingIterations,
  );
  session.elapsed.extracting = performance.now() - extractStart;
  progress(id, "cleaning", 1, "Connected components cleaned");
  const mesh: MeshData = {
    positions: session.wasm.mesh_positions(),
    normals: session.wasm.mesh_normals(),
    colors: session.wasm.mesh_colors(),
    indices: session.wasm.mesh_indices(),
  };
  progress(id, "normals", 1, "Normals and DC colors ready");
  progress(id, "ready", 1);
  const result = {
    mesh,
    report: session.report,
    dims: session.dims,
    voxelCount: session.voxelCount,
    gridMemory: session.gridMemory,
    density: session.density,
    isoThreshold: iso,
    elapsed: session.elapsed,
  };
  self.postMessage(
    { type: "ready", id, result },
    { transfer: transferables(mesh) },
  );
}
