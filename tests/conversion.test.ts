import { describe, expect, it } from "vitest";
import {
  buildSpatialIndex,
  cleanupMesh,
  densityStats,
  estimateGrid,
  extractMarchingTetrahedra,
  gaussianDensity,
  voxelize,
} from "../src/conversion/engine";
import { friendlyError } from "../src/conversion/errors";
import { automaticIso } from "../src/conversion/iso";
import {
  DEFAULT_PARAMS,
  formatBytes,
  paramsForPreset,
} from "../src/conversion/params";
import { parsePly } from "../src/conversion/ply";
import { splatFormat } from "../src/conversion/splats";
import { outputFilename } from "../src/exporters/names";
import { createSyntheticSample } from "../src/samples/synthetic";
import type { ConversionParams, Gaussian, MeshData } from "../src/types/model";

const simpleGaussian = (
  mean: [number, number, number] = [0, 0, 0],
): Gaussian => ({
  mean,
  scale: [1, 1, 1],
  rotation: [1, 0, 0, 0, 1, 0, 0, 0, 1],
  opacity: 0.8,
  color: [1, 0.2, 0.1],
});
const lowParams: ConversionParams = {
  ...DEFAULT_PARAMS,
  resolution: 18,
  minComponentFaces: 1,
  smoothingIterations: 0,
};

describe("conversion primitives", () => {
  it("maps presets and formats memory estimates", () => {
    expect(paramsForPreset("fast").resolution).toBe(64);
    expect(DEFAULT_PARAMS.backend).toBe("auto");
    expect(paramsForPreset("detailed").resolution).toBe(160);
    expect(formatBytes(1024 ** 2)).toBe("1.0 MiB");
  });
  it("selects a positive iso value for a sparse first histogram bin", () => {
    const histogram = Array.from({ length: 32 }, (_, index) =>
      index === 0 ? 100 : 0,
    );
    expect(
      automaticIso({ min: 0, max: 1, nonZero: 100, histogram }),
    ).toBeGreaterThan(0);
  });
  it("creates descriptive output filenames", () => {
    expect(outputFilename("folder/my-scene.ply", "glb")).toBe(
      "my-scene-mesh.glb",
    );
    expect(outputFilename("asset.PLY", "ply")).toBe("asset-mesh.ply");
    expect(outputFilename("asset.spz", "glb")).toBe("asset-mesh.glb");
  });
  it("has symmetric density for an identity Gaussian", () => {
    const g = simpleGaussian();
    expect(gaussianDensity(g, [0.2, 0, 0], 3)).toBeCloseTo(
      gaussianDensity(g, [-0.2, 0, 0], 3),
    );
  });
  it("bins candidates into deterministic tiles", () => {
    const gs = [simpleGaussian(), simpleGaussian([4, 0, 0])];
    const estimate = estimateGrid(gs, lowParams);
    const index = buildSpatialIndex(
      gs,
      estimate.bounds,
      estimate.spacing,
      estimate.dims,
      3,
    );
    expect(
      index.buckets.every((bucket) =>
        bucket.every((value, i) => i === 0 || value >= bucket[i - 1]),
      ),
    ).toBe(true);
  });
  it("extracts a non-empty tetrahedral sphere surface with finite normals", () => {
    const gs = [simpleGaussian()];
    const field = voxelize(gs, lowParams);
    const stats = densityStats(field.density);
    const mesh = extractMarchingTetrahedra(field, gs, stats.max * 0.2, 3);
    expect(mesh.indices.length).toBeGreaterThan(0);
    expect([...mesh.positions, ...mesh.normals].every(Number.isFinite)).toBe(
      true,
    );
  });
  it("removes small connected components", () => {
    const mesh: MeshData = {
      positions: new Float32Array([
        0, 0, 0, 1, 0, 0, 0, 1, 0, 10, 0, 0, 11, 0, 0, 10, 1, 0,
      ]),
      normals: new Float32Array(18),
      colors: new Float32Array(18),
      indices: new Uint32Array([0, 1, 2, 3, 4, 5]),
    };
    const clean = cleanupMesh(mesh, true, 1, 0);
    expect(clean.indices.length).toBe(3);
  });
  it("keeps smoothing finite", () => {
    const mesh = cleanupMesh(
      extractMarchingTetrahedra(
        voxelize([simpleGaussian()], lowParams),
        [simpleGaussian()],
        0.15,
        3,
      ),
      true,
      1,
      1,
    );
    expect([...mesh.positions].every(Number.isFinite)).toBe(true);
  });
});

describe("PLY and sample", () => {
  it("detects supported packed splat extensions", () => {
    expect(splatFormat("scene.spz")).toBe("spz");
    expect(splatFormat("scene.splat")).toBe("splat");
    expect(splatFormat("scene.ksplat")).toBe("ksplat");
    expect(splatFormat("scene.sog")).toBe("sog");
    expect(splatFormat("scene.zip")).toBe("sog");
    expect(() => splatFormat("scene.xyz")).toThrow(/Unsupported input format/);
  });
  it("sample produces a surface at automatic iso", () => {
    const parsed = parsePly(createSyntheticSample());
    const field = voxelize(parsed.gaussians, lowParams);
    const iso = automaticIso(field.stats);
    const mesh = extractMarchingTetrahedra(
      field,
      parsed.gaussians,
      iso,
      lowParams.sigmaRadius,
    );
    console.log(
      "sample stats",
      field.dims,
      field.stats,
      iso,
      mesh.positions.length / 3,
      mesh.indices.length / 3,
    );
    expect(mesh.indices.length).toBeGreaterThan(0);
  });
  it("sample remains non-empty at fast cleanup defaults", () => {
    const parsed = parsePly(createSyntheticSample());
    const params = { ...DEFAULT_PARAMS, resolution: 64 };
    const field = voxelize(parsed.gaussians, params);
    const mesh = extractMarchingTetrahedra(
      field,
      parsed.gaussians,
      automaticIso(field.stats),
      params.sigmaRadius,
    );
    const clean = cleanupMesh(
      mesh,
      params.keepLargestComponent,
      params.minComponentFaces,
      params.smoothingIterations,
    );
    console.log(
      "fast mesh",
      field.dims,
      mesh.indices.length / 3,
      clean.indices.length / 3,
    );
    expect(clean.indices.length).toBeGreaterThan(0);
  });
  it("generates and parses the deterministic binary sample", () => {
    const parsed = parsePly(createSyntheticSample());
    expect(parsed.report.inputCount).toBeGreaterThan(100);
    expect(parsed.report.retainedCount).toBe(parsed.report.inputCount);
    expect(parsed.gaussians[0].rotation).toHaveLength(9);
  });
  it("parses ASCII with arbitrary property order", () => {
    const ascii = new TextEncoder().encode(
      "ply\nformat ascii 1.0\nelement vertex 1\nproperty float scale_1\nproperty float x\nproperty float rot_3\nproperty float z\nproperty float rot_0\nproperty float opacity\nproperty float y\nproperty float scale_0\nproperty float rot_1\nproperty float scale_2\nproperty float rot_2\nproperty float rot_0_extra\nend_header\n0 1 0 0 1 0 2 -1 0 0 0 0\n",
    );
    const parsed = parsePly(ascii);
    expect(parsed.gaussians[0].mean).toEqual([1, 2, 0]);
  });
  it("reports missing required fields and friendly errors", () => {
    expect(() =>
      parsePly(
        new TextEncoder().encode(
          "ply\nformat ascii 1.0\nelement vertex 1\nproperty float x\nend_header\n0\n",
        ),
      ),
    ).toThrow(/Missing required PLY properties/);
    expect(
      friendlyError(new Error("grid allocation would require 1 GiB")),
    ).toMatch(/Fast preset/);
  });
});
