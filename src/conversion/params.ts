import type { ConversionParams, PresetName } from "../types/model";

export const PRESETS: Record<
  PresetName,
  Pick<ConversionParams, "resolution" | "opacityThreshold" | "sigmaRadius">
> = {
  fast: { resolution: 64, opacityThreshold: 0.035, sigmaRadius: 3 },
  balanced: { resolution: 96, opacityThreshold: 0.02, sigmaRadius: 3 },
  detailed: { resolution: 160, opacityThreshold: 0.012, sigmaRadius: 3 },
};

export const DEFAULT_PARAMS: ConversionParams = {
  ...PRESETS.balanced,
  backend: "auto",
  boundsQuantile: 0.01,
  cropEnabled: false,
  cropMin: [0, 0, 0],
  cropMax: [1, 1, 1],
  isoMode: "automatic",
  isoThreshold: 0.1,
  keepLargestComponent: true,
  minComponentFaces: 16,
  smoothingIterations: 1,
  decimationRatio: 1,
  decimationMethod: "quadric",
  densityDenoiseIterations: 0,
  fillEnclosedVoids: false,
  surfaceField: "density",
  distanceBandVoxels: 4,
  maxHoleEdges: 0,
  lowMemoryMode: false,
  slabDepth: 24,
};

export function paramsForPreset(
  preset: PresetName,
  current: ConversionParams = DEFAULT_PARAMS,
): ConversionParams {
  return { ...current, ...PRESETS[preset] };
}

export function estimateGrid(
  resolution: number,
  extent: [number, number, number] = [1, 1, 1],
) {
  const longest = Math.max(...extent, 1e-6);
  const spacing = longest / Math.max(2, resolution);
  const dims = extent.map((v) => Math.min(512, Math.ceil(v / spacing) + 1)) as [
    number,
    number,
    number,
  ];
  const voxels = dims[0] * dims[1] * dims[2];
  return { dims, voxels, bytes: voxels * 4 };
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "—";
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  const units = ["KiB", "MiB", "GiB"];
  let value = bytes;
  let unit = "B";
  for (const candidate of units) {
    value /= 1024;
    unit = candidate;
    if (value < 1024 || candidate === "GiB") break;
  }
  return `${value.toFixed(value >= 10 ? 0 : 1)} ${unit}`;
}
