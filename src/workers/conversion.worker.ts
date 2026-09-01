import { cleanupMesh, extractMarchingTetrahedra } from "../conversion/engine";
import { automaticIso } from "../conversion/iso";
import { decodeSplats, packActivatedGaussians } from "../conversion/splats";
import { voxelizeWebGpu } from "../conversion/webgpu";
import type {
  ConversionParams,
  DensityStats,
  Gaussian,
  GridField,
  MeshData,
  ParseReport,
  WorkerRequest,
} from "../types/model";
import initWasm, { ConversionSession } from "../wasm/mesh_wasm.js";

interface WasmDensityStats extends DensityStats {
  iso: number;
}
interface Session {
  wasm?: ConversionSession;
  field?: GridField;
  gaussians?: Gaussian[];
  report: ParseReport;
  density: WasmDensityStats;
  dims: [number, number, number];
  voxelCount: number;
  gridMemory: number;
  elapsed: Record<string, number>;
  backendUsed: "webgpu" | "wasm";
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
        session?.wasm?.free();
        session = undefined;
        const elapsed: Record<string, number> = {};
        const parseStart = performance.now();
        progress(request.id, "parsing", 0, `Decoding ${request.filename}`);
        const parsed = await decodeSplats(
          request.bytes,
          request.filename,
          request.params.opacityThreshold,
        );
        elapsed.parsing = performance.now() - parseStart;
        progress(
          request.id,
          "activating",
          1,
          `${parsed.report.retainedCount.toLocaleString()} Gaussians retained`,
          elapsed.parsing,
        );
        let webGpuError: string | undefined;
        if (request.params.backend !== "wasm") {
          const voxelStart = performance.now();
          try {
            progress(
              request.id,
              "indexing",
              0,
              "Preparing WebGPU spatial bins",
            );
            const field = await voxelizeWebGpu(
              parsed.gaussians,
              request.params,
              (value, message) =>
                progress(request.id, "voxelizing", value, message),
            );
            elapsed.voxelizing = performance.now() - voxelStart;
            const density: WasmDensityStats = {
              ...field.stats,
              iso: automaticIso(field.stats),
            };
            session = {
              field,
              gaussians: parsed.gaussians,
              report: parsed.report,
              density,
              dims: field.dims,
              voxelCount: field.density.length,
              gridMemory: field.density.byteLength,
              elapsed,
              backendUsed: "webgpu",
            };
          } catch (error) {
            webGpuError =
              error instanceof Error ? error.message : String(error);
            if (request.params.backend === "webgpu") throw error;
          }
        }
        if (!session) {
          if (webGpuError)
            parsed.report.warnings.push(
              `WebGPU was unavailable (${webGpuError}); CPU/WASM was used.`,
            );
          wasmReady ??= initWasm();
          await wasmReady;
          progress(request.id, "indexing", 0, "Preparing Rust/WASM session");
          const wasm =
            parsed.report.sourceFormat === "ply"
              ? new ConversionSession(
                  new Uint8Array(request.bytes),
                  request.params.resolution,
                  request.params.opacityThreshold,
                  request.params.sigmaRadius,
                  request.params.boundsQuantile,
                )
              : ConversionSession.fromActivated(
                  packActivatedGaussians(parsed.gaussians),
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
            "Building CPU bins and density field",
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
            backendUsed: "wasm",
          };
        }
        await extractAndReply(
          request.id,
          request.params,
          request.params.isoMode === "manual"
            ? request.params.isoThreshold
            : session.density.iso,
        );
      } else {
        if (!session)
          throw new Error("Load a 3DGS file before changing the iso threshold");
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
  let mesh: MeshData;
  if (session.wasm) {
    session.wasm.set_iso_threshold(iso);
    session.wasm.extract_mesh(
      params.keepLargestComponent,
      params.minComponentFaces,
      params.smoothingIterations,
    );
    session.elapsed.extracting = performance.now() - extractStart;
    mesh = {
      positions: session.wasm.mesh_positions(),
      normals: session.wasm.mesh_normals(),
      colors: session.wasm.mesh_colors(),
      indices: session.wasm.mesh_indices(),
    };
  } else {
    if (!session.field || !session.gaussians)
      throw new Error("WebGPU session data is unavailable");
    const raw = extractMarchingTetrahedra(
      session.field,
      session.gaussians,
      iso,
      params.sigmaRadius,
    );
    session.elapsed.extracting = performance.now() - extractStart;
    progress(id, "cleaning", 0, "Cleaning connected components");
    const cleanupStart = performance.now();
    mesh = cleanupMesh(
      raw,
      params.keepLargestComponent,
      params.minComponentFaces,
      params.smoothingIterations,
    );
    session.elapsed.cleaning = performance.now() - cleanupStart;
  }
  progress(id, "cleaning", 1, "Connected components cleaned");
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
    backendUsed: session.backendUsed,
  };
  self.postMessage(
    { type: "ready", id, result },
    { transfer: transferables(mesh) },
  );
}
