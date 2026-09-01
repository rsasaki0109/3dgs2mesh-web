import type { DensityStats } from "../types/model";

export function automaticIso(stats: DensityStats): number {
  if (stats.max <= 0) return 0;
  const target = Math.max(1, Math.ceil(stats.nonZero * 0.55));
  let accumulated = 0;
  const range = Math.max(1e-6, stats.max - stats.min);
  for (let i = 0; i < stats.histogram.length; i += 1) {
    accumulated += stats.histogram[i];
    if (accumulated >= target)
      return stats.min + range * ((i + 0.5) / stats.histogram.length);
  }
  return stats.max * 0.2;
}
