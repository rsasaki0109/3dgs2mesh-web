import type {
  ConversionParams,
  DensityStats,
  GpuInfo,
  MeshQuality,
  ParseReport,
} from "../types/model";

export const BENCHMARK_SCHEMA = "3dgs2mesh-web/benchmark-v1";

export interface BenchmarkResultInput {
  sourceName: string;
  sourceBytes: number;
  report: ParseReport;
  params: ConversionParams;
  backendUsed: "webgpu" | "wasm" | "cpu-streaming";
  gpuInfo?: GpuInfo;
  dims: [number, number, number];
  voxelCount: number;
  density: DensityStats;
  vertices: number;
  triangles: number;
  elapsed: Record<string, number>;
  backendTimings?: { indexing: number; compute: number; readback: number };
  validation?: {
    samples: number;
    maxAbsError: number;
    maxRelativeError: number;
  };
  quality: MeshQuality;
}

export function buildBenchmarkReport(
  input: BenchmarkResultInput,
  environment: {
    userAgent: string;
    hardwareConcurrency?: number;
    webGpuAvailable: boolean;
    timestamp?: string;
  },
) {
  return {
    schema: BENCHMARK_SCHEMA,
    appVersion: "0.2.0",
    timestamp: environment.timestamp ?? new Date().toISOString(),
    environment: {
      userAgent: environment.userAgent,
      hardwareConcurrency: environment.hardwareConcurrency,
      webGpuAvailable: environment.webGpuAvailable,
    },
    gpu: input.gpuInfo ?? null,
    source: {
      name: input.sourceName,
      bytes: input.sourceBytes,
      format: input.report.sourceFormat,
      inputGaussians: input.report.inputCount,
      retainedGaussians: input.report.retainedCount,
    },
    params: input.params,
    result: {
      backend: input.backendUsed,
      dims: input.dims,
      voxelCount: input.voxelCount,
      densityRange: [input.density.min, input.density.max],
      vertices: input.vertices,
      triangles: input.triangles,
      elapsedMs: input.elapsed,
      backendTimingsMs: input.backendTimings ?? null,
      validation: input.validation ?? null,
      topology: input.quality,
    },
  };
}
