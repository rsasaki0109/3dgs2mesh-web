import type {
  Gaussian,
  ParsedPly,
  ParseReport,
  SplatFormat,
} from "../types/model";
import { parsePly, quaternionToMatrix } from "./ply";

const SUPPORTED_EXTENSIONS: Record<string, SplatFormat> = {
  ply: "ply",
  spz: "spz",
  splat: "splat",
  ksplat: "ksplat",
  sog: "sog",
  zip: "sog",
};

export function splatFormat(filename: string): SplatFormat {
  const extension = filename.split(".").pop()?.toLowerCase();
  if (extension && SUPPORTED_EXTENSIONS[extension])
    return SUPPORTED_EXTENSIONS[extension];
  throw new Error(
    "Unsupported input format. Choose a PLY, SPZ, SPLAT, KSPLAT, or packaged SOG file.",
  );
}

function finiteGaussian(gaussian: Gaussian) {
  return (
    gaussian.mean.every(Number.isFinite) &&
    gaussian.scale.every(Number.isFinite) &&
    gaussian.rotation.every(Number.isFinite) &&
    Number.isFinite(gaussian.opacity) &&
    gaussian.color.every(Number.isFinite)
  );
}

function reportScaleWarning(gaussians: Gaussian[], report: ParseReport) {
  let extreme = 0;
  for (const gaussian of gaussians) {
    const smallest = Math.max(1e-6, Math.min(...gaussian.scale));
    if (Math.max(...gaussian.scale) / smallest > 100) extreme += 1;
  }
  if (extreme > Math.max(4, gaussians.length * 0.01))
    report.warnings.push(
      "Some Gaussian scales are extremely anisotropic; reconstruction bounds or thin surfaces may be unstable.",
    );
}

/** Decode every supported splat format into the activated representation used by meshing. */
export async function decodeSplats(
  input: Uint8Array | ArrayBuffer,
  filename: string,
  opacityThreshold = 0,
): Promise<ParsedPly> {
  const format = splatFormat(filename);
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (format === "ply") {
    const parsed = parsePly(bytes, opacityThreshold);
    parsed.report.sourceFormat = format;
    return parsed;
  }

  const { PackedSplats } = await import("@sparkjsdev/spark");
  const packed = new PackedSplats({
    fileBytes: bytes.slice(),
    fileName: filename,
  });
  try {
    await packed.initialized;
    const gaussians: Gaussian[] = [];
    let rejectedOpacity = 0;
    let rejectedNonFinite = 0;
    packed.forEachSplat(
      (_index, center, scales, quaternion, opacity, color) => {
        const gaussian: Gaussian = {
          mean: [center.x, center.y, center.z],
          scale: [
            Math.max(1e-6, scales.x),
            Math.max(1e-6, scales.y),
            Math.max(1e-6, scales.z),
          ],
          rotation: quaternionToMatrix([
            quaternion.w,
            quaternion.x,
            quaternion.y,
            quaternion.z,
          ]),
          opacity,
          color: [color.r, color.g, color.b],
        };
        if (!finiteGaussian(gaussian)) rejectedNonFinite += 1;
        else if (gaussian.opacity < opacityThreshold) rejectedOpacity += 1;
        else gaussians.push(gaussian);
      },
    );
    const inputCount = packed.getNumSplats();
    if (!gaussians.length)
      throw new Error(
        `No Gaussians remain after decoding ${format.toUpperCase()} and applying the opacity threshold.`,
      );
    const report: ParseReport = {
      inputCount,
      retainedCount: gaussians.length,
      rejectedOpacity,
      rejectedNonFinite,
      warnings: [
        `${format.toUpperCase()} uses a packed or quantized representation; geometry may differ slightly from an uncompressed training PLY.`,
      ],
      sourceFormat: format,
    };
    if (rejectedOpacity > inputCount * 0.5)
      report.warnings.push(
        `${Math.round((rejectedOpacity / inputCount) * 100)}% of Gaussians were below the opacity threshold.`,
      );
    reportScaleWarning(gaussians, report);
    return { gaussians, report };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (format === "spz" && /gzip header/i.test(message))
      throw new Error(
        "Could not decode SPZ: this appears to be SPZ v4, which the current browser decoder cannot read. Export SPZ v3 or Graphdeco PLY instead.",
      );
    throw new Error(`Could not decode ${format.toUpperCase()}: ${message}`);
  } finally {
    packed.dispose();
  }
}

export function packActivatedGaussians(gaussians: Gaussian[]) {
  const packed = new Float32Array(gaussians.length * 19);
  for (let i = 0; i < gaussians.length; i += 1) {
    const gaussian = gaussians[i];
    const offset = i * 19;
    packed.set(gaussian.mean, offset);
    packed.set(gaussian.scale, offset + 3);
    packed.set(gaussian.rotation, offset + 6);
    packed[offset + 15] = gaussian.opacity;
    packed.set(gaussian.color, offset + 16);
  }
  return packed;
}
