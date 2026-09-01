import {
  analyzeMesh,
  cleanupMesh,
  decimateMesh,
  extractMarchingTetrahedra,
} from "../conversion/engine";
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
let loaded:
  | {
      filename: string;
      gaussians: Gaussian[];
      report: ParseReport;
      bounds: { min: [number, number, number]; max: [number, number, number] };
    }
  | undefined;
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
        if (!loaded) throw new Error("Load a 3DGS file before converting");
        const source = loaded;
        session?.wasm?.free();
        session = undefined;
        const elapsed: Record<string, number> = {};
        const parseStart = performance.now();
        progress(request.id, "parsing", 0, `Using decoded ${source.filename}`);
        const cropMin = source.bounds.min.map(
          (value, axis) =>
            value +
            (source.bounds.max[axis] - value) * request.params.cropMin[axis],
        );
        const cropMax = source.bounds.min.map(
          (value, axis) =>
            value +
            (source.bounds.max[axis] - value) * request.params.cropMax[axis],
        );
        let rejectedCrop = 0;
        const gaussians = source.gaussians.filter((gaussian) => {
          if (gaussian.opacity < request.params.opacityThreshold) return false;
          const inside = gaussian.mean.every(
            (value, axis) => value >= cropMin[axis] && value <= cropMax[axis],
          );
          if (request.params.cropEnabled && !inside) rejectedCrop += 1;
          return !request.params.cropEnabled || inside;
        });
        if (!gaussians.length)
          throw new Error(
            "No Gaussians remain after opacity filtering and cropping",
          );
        const report: ParseReport = {
          ...source.report,
          warnings: [...source.report.warnings],
          retainedCount: gaussians.length,
          rejectedOpacity:
            source.report.rejectedOpacity +
            source.gaussians.filter(
              (gaussian) => gaussian.opacity < request.params.opacityThreshold,
            ).length,
          rejectedCrop,
        };
        if (rejectedCrop > source.gaussians.length * 0.5)
          report.warnings.push(
            `${Math.round((rejectedCrop / source.gaussians.length) * 100)}% of Gaussians are outside the crop box.`,
          );
        const parsed = { gaussians, report };
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
          const wasm = ConversionSession.fromActivated(
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
      } else if (request.type === "extract") {
        if (!session)
          throw new Error("Load a 3DGS file before changing the iso threshold");
        await extractAndReply(request.id, request.params, request.isoThreshold);
      } else if (request.type === "load") {
        session?.wasm?.free();
        session = undefined;
        loaded = undefined;
        const parsed = await decodeSplats(request.bytes, request.filename, 0);
        const bounds = {
          min: [Infinity, Infinity, Infinity] as [number, number, number],
          max: [-Infinity, -Infinity, -Infinity] as [number, number, number],
        };
        for (const gaussian of parsed.gaussians)
          for (let axis = 0; axis < 3; axis += 1) {
            bounds.min[axis] = Math.min(bounds.min[axis], gaussian.mean[axis]);
            bounds.max[axis] = Math.max(bounds.max[axis], gaussian.mean[axis]);
          }
        loaded = {
          filename: request.filename,
          gaussians: parsed.gaussians,
          report: parsed.report,
          bounds,
        };
        const previewCount = Math.min(50_000, parsed.gaussians.length);
        const previewPositions = new Float32Array(previewCount * 3);
        const previewColors = new Float32Array(previewCount * 3);
        for (let i = 0; i < previewCount; i += 1) {
          const sourceIndex = Math.min(
            parsed.gaussians.length - 1,
            Math.floor((i * parsed.gaussians.length) / previewCount),
          );
          previewPositions.set(parsed.gaussians[sourceIndex].mean, i * 3);
          previewColors.set(parsed.gaussians[sourceIndex].color, i * 3);
        }
        self.postMessage(
          {
            type: "loaded",
            id: request.id,
            result: {
              report: parsed.report,
              previewPositions,
              previewColors,
              bounds,
            },
          },
          { transfer: [previewPositions.buffer, previewColors.buffer] },
        );
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
  let preCleanupVertices = 0;
  let preCleanupTriangles = 0;
  if (session.wasm) {
    session.wasm.set_iso_threshold(iso);
    session.wasm.extract_mesh(
      params.keepLargestComponent,
      params.minComponentFaces,
      params.smoothingIterations,
    );
    session.elapsed.extracting = performance.now() - extractStart;
    preCleanupVertices = session.wasm.raw_vertex_count();
    preCleanupTriangles = session.wasm.raw_triangle_count();
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
    preCleanupVertices = raw.positions.length / 3;
    preCleanupTriangles = raw.indices.length / 3;
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
  const preDecimationVertices = mesh.positions.length / 3;
  const preDecimationTriangles = mesh.indices.length / 3;
  if (params.decimationRatio < 0.999)
    mesh = decimateMesh(mesh, params.decimationRatio);
  const quality = {
    ...analyzeMesh(mesh),
    preDecimationVertices,
    preDecimationTriangles,
    preCleanupVertices,
    preCleanupTriangles,
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
    backendUsed: session.backendUsed,
    backendTimings: session.field?.backendTimings,
    validation: session.field?.validation,
    quality,
  };
  self.postMessage(
    { type: "ready", id, result },
    { transfer: transferables(mesh) },
  );
}
