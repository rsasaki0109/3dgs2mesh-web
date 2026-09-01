export type Vec3 = [number, number, number];
export type SplatFormat = "ply" | "spz" | "splat" | "ksplat" | "sog";

export interface Gaussian {
  mean: Vec3;
  scale: Vec3;
  rotation: number[];
  opacity: number;
  color: [number, number, number];
}

export interface ParseReport {
  inputCount: number;
  retainedCount: number;
  rejectedOpacity: number;
  rejectedNonFinite: number;
  rejectedCrop?: number;
  warnings: string[];
  sourceFormat?: SplatFormat;
}

export interface ParsedPly {
  gaussians: Gaussian[];
  report: ParseReport;
}

export interface ConversionParams {
  backend: "auto" | "webgpu" | "wasm";
  resolution: number;
  opacityThreshold: number;
  sigmaRadius: number;
  boundsQuantile: number;
  cropEnabled: boolean;
  cropMin: Vec3;
  cropMax: Vec3;
  isoMode: "automatic" | "manual";
  isoThreshold: number;
  keepLargestComponent: boolean;
  minComponentFaces: number;
  smoothingIterations: number;
  decimationRatio: number;
  decimationMethod: "quadric" | "cluster";
  densityDenoiseIterations: number;
  fillEnclosedVoids: boolean;
  maxHoleEdges: number;
  lowMemoryMode: boolean;
  slabDepth: number;
}

export type PresetName = "fast" | "balanced" | "detailed";

export interface DensityStats {
  min: number;
  max: number;
  nonZero: number;
  histogram: number[];
}

export interface GridField {
  dims: [number, number, number];
  min: Vec3;
  max: Vec3;
  spacing: number;
  density: Float32Array;
  stats: DensityStats;
  index: SpatialIndex;
  backendTimings?: { indexing: number; compute: number; readback: number };
  validation?: {
    samples: number;
    maxAbsError: number;
    maxRelativeError: number;
  };
  gpuInfo?: GpuInfo;
  gridOffset?: Vec3;
}

export interface SpatialIndex {
  tileEdge: number;
  tileDims: [number, number, number];
  buckets: number[][];
}

export interface MeshData {
  positions: Float32Array;
  normals: Float32Array;
  colors: Float32Array;
  indices: Uint32Array;
}

export interface MeshQuality {
  boundaryEdges: number;
  nonManifoldEdges: number;
  degenerateFaces: number;
  components: number;
  preDecimationVertices: number;
  preDecimationTriangles: number;
  preCleanupVertices: number;
  preCleanupTriangles: number;
  denoisedVoxels: number;
  enclosedVoxelsFilled: number;
  holesFilled: number;
  peakDensityBytes: number;
}

export interface GpuInfo {
  vendor?: string;
  architecture?: string;
  device?: string;
  description?: string;
}

export interface ConversionResult {
  mesh: MeshData;
  field: GridField;
  report: ParseReport;
  isoThreshold: number;
  elapsed: Record<string, number>;
}

export type ConversionStage =
  | "parsing"
  | "activating"
  | "indexing"
  | "voxelizing"
  | "extracting"
  | "cleaning"
  | "normals"
  | "ready";

export interface WorkerStartMessage {
  type: "start";
  id: number;
  params: ConversionParams;
}

export interface WorkerLoadMessage {
  type: "load";
  id: number;
  bytes: ArrayBuffer;
  filename: string;
}

export interface WorkerExtractMessage {
  type: "extract";
  id: number;
  params: ConversionParams;
  isoThreshold: number;
}

export interface WorkerCancelMessage {
  type: "cancel";
}

export type WorkerRequest =
  | WorkerLoadMessage
  | WorkerStartMessage
  | WorkerExtractMessage
  | WorkerCancelMessage;

export interface WorkerProgressMessage {
  type: "progress";
  id: number;
  stage: ConversionStage;
  percent: number;
  detail?: string;
  elapsed?: number;
}

export interface WorkerReadyMessage {
  type: "ready";
  id: number;
  result: {
    mesh: MeshData;
    report: ParseReport;
    dims: [number, number, number];
    voxelCount: number;
    gridMemory: number;
    density: DensityStats;
    isoThreshold: number;
    elapsed: Record<string, number>;
    backendUsed: "webgpu" | "wasm" | "cpu-streaming";
    backendTimings?: GridField["backendTimings"];
    validation?: GridField["validation"];
    quality: MeshQuality;
    gpuInfo?: GpuInfo;
    lowMemoryUsed: boolean;
  };
}

export interface WorkerLoadedMessage {
  type: "loaded";
  id: number;
  result: {
    report: ParseReport;
    previewPositions: Float32Array;
    previewColors: Float32Array;
    bounds: { min: Vec3; max: Vec3 };
  };
}

export interface WorkerErrorMessage {
  type: "error";
  id: number;
  message: string;
}

export type WorkerResponse =
  | WorkerLoadedMessage
  | WorkerProgressMessage
  | WorkerReadyMessage
  | WorkerErrorMessage;
