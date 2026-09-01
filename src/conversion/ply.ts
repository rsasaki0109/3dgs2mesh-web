import type { Gaussian, ParsedPly, ParseReport, Vec3 } from "../types/model";

export const SH_C0 = 0.28209479177387814;
const EPSILON = 1e-5;

type ScalarType =
  | "int8"
  | "uint8"
  | "int16"
  | "uint16"
  | "int32"
  | "uint32"
  | "float32"
  | "float64";
interface Property {
  name: string;
  type: ScalarType;
}

const SCALAR_TYPES: Record<string, { type: ScalarType; size: number }> = {
  char: { type: "int8", size: 1 },
  int8: { type: "int8", size: 1 },
  uchar: { type: "uint8", size: 1 },
  uint8: { type: "uint8", size: 1 },
  short: { type: "int16", size: 2 },
  int16: { type: "int16", size: 2 },
  ushort: { type: "uint16", size: 2 },
  uint16: { type: "uint16", size: 2 },
  int: { type: "int32", size: 4 },
  int32: { type: "int32", size: 4 },
  uint: { type: "uint32", size: 4 },
  uint32: { type: "uint32", size: 4 },
  float: { type: "float32", size: 4 },
  float32: { type: "float32", size: 4 },
  double: { type: "float64", size: 8 },
  float64: { type: "float64", size: 8 },
};

function friendlyNumber(value: number, field: string, row: number): number {
  if (!Number.isFinite(value))
    throw new Error(`Non-finite ${field} at Gaussian ${row}`);
  return value;
}

export function sigmoid(value: number): number {
  if (value >= 0) return 1 / (1 + Math.exp(-value));
  const e = Math.exp(value);
  return e / (1 + e);
}

export function normalizeQuaternion(
  q: [number, number, number, number],
): [number, number, number, number] {
  const length = Math.hypot(...q);
  if (!Number.isFinite(length) || length < EPSILON) return [1, 0, 0, 0];
  return q.map((v) => v / length) as [number, number, number, number];
}

export function quaternionToMatrix(
  q: [number, number, number, number],
): number[] {
  const [w, x, y, z] = normalizeQuaternion(q);
  return [
    1 - 2 * (y * y + z * z),
    2 * (x * y - z * w),
    2 * (x * z + y * w),
    2 * (x * y + z * w),
    1 - 2 * (x * x + z * z),
    2 * (y * z - x * w),
    2 * (x * z - y * w),
    2 * (y * z + x * w),
    1 - 2 * (x * x + y * y),
  ];
}

function headerInfo(bytes: Uint8Array) {
  const marker = new TextEncoder().encode("end_header");
  let start = -1;
  outer: for (let i = 0; i <= bytes.length - marker.length; i += 1) {
    for (let j = 0; j < marker.length; j += 1)
      if (
        String.fromCharCode(bytes[i + j]).toLowerCase() !==
        String.fromCharCode(marker[j])
      )
        continue outer;
    start = i;
    break;
  }
  if (start < 0) throw new Error("PLY header is missing end_header");
  let dataOffset = start + marker.length;
  while (
    dataOffset < bytes.length &&
    (bytes[dataOffset] === 10 || bytes[dataOffset] === 13)
  )
    dataOffset += 1;
  const header = new TextDecoder("utf-8", { fatal: true }).decode(
    bytes.slice(0, start + marker.length),
  );
  return { header, dataOffset };
}

function activate(values: Record<string, number>, row: number): Gaussian {
  const mean: Vec3 = [
    friendlyNumber(values.x, "x", row),
    friendlyNumber(values.y, "y", row),
    friendlyNumber(values.z, "z", row),
  ];
  const rawScale: Vec3 = [values.scale_0, values.scale_1, values.scale_2].map(
    (v, i) => friendlyNumber(v, `scale_${i}`, row),
  ) as Vec3;
  const scale: Vec3 = rawScale.map((v) =>
    Math.max(EPSILON, Math.exp(v)),
  ) as Vec3;
  const opacity = sigmoid(friendlyNumber(values.opacity, "opacity", row));
  const q: [number, number, number, number] = [
    values.rot_0,
    values.rot_1,
    values.rot_2,
    values.rot_3,
  ].map((v, i) => friendlyNumber(v, `rot_${i}`, row)) as [
    number,
    number,
    number,
    number,
  ];
  const color: [number, number, number] = [0, 1, 2].map((i) => {
    const raw = values[`f_dc_${i}`];
    return raw === undefined || !Number.isFinite(raw)
      ? [0.55, 0.58, 0.62][i]
      : Math.max(0, Math.min(1, 0.5 + SH_C0 * raw));
  }) as [number, number, number];
  return { mean, scale, rotation: quaternionToMatrix(q), opacity, color };
}

function readScalar(view: DataView, offset: number, type: ScalarType): number {
  switch (type) {
    case "int8":
      return view.getInt8(offset);
    case "uint8":
      return view.getUint8(offset);
    case "int16":
      return view.getInt16(offset, true);
    case "uint16":
      return view.getUint16(offset, true);
    case "int32":
      return view.getInt32(offset, true);
    case "uint32":
      return view.getUint32(offset, true);
    case "float32":
      return view.getFloat32(offset, true);
    case "float64":
      return view.getFloat64(offset, true);
  }
}

export function parsePly(
  input: ArrayBuffer | Uint8Array,
  opacityThreshold = 0.02,
): ParsedPly {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (
    bytes.length < 16 ||
    new TextDecoder().decode(bytes.slice(0, 3)) !== "ply"
  )
    throw new Error("The selected file is not a valid PLY file");
  const { header, dataOffset } = headerInfo(bytes);
  const lines = header
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const format =
    lines.find((line) => line.startsWith("format "))?.split(/\s+/)[1] ?? "";
  if (format === "binary_big_endian")
    throw new Error(
      "binary_big_endian PLY is not supported; export little-endian or ASCII",
    );
  if (format !== "ascii" && format !== "binary_little_endian")
    throw new Error(`Unsupported PLY format: ${format || "unknown"}`);
  let vertexCount = 0;
  let inVertex = false;
  const properties: Property[] = [];
  for (const line of lines) {
    const parts = line.split(/\s+/);
    if (parts[0] === "element") {
      inVertex = parts[1] === "vertex";
      if (inVertex) vertexCount = Number(parts[2]);
      continue;
    }
    if (inVertex && parts[0] === "property") {
      if (parts[1] === "list")
        throw new Error(
          "Unsupported list property in vertex element; vertex properties must be scalar values",
        );
      const info = SCALAR_TYPES[parts[1]];
      if (!info) throw new Error(`Unsupported PLY scalar type: ${parts[1]}`);
      properties.push({ name: parts[2], type: info.type });
    }
  }
  if (!Number.isSafeInteger(vertexCount) || vertexCount <= 0)
    throw new Error("PLY must contain a non-empty vertex element");
  if (vertexCount > 20_000_000)
    throw new Error(
      "This PLY declares more than 20 million vertices; crop the scene before loading it",
    );
  const required = [
    "x",
    "y",
    "z",
    "opacity",
    "scale_0",
    "scale_1",
    "scale_2",
    "rot_0",
    "rot_1",
    "rot_2",
    "rot_3",
  ];
  const names = new Set(properties.map((p) => p.name));
  const missing = required.filter((name) => !names.has(name));
  if (missing.length)
    throw new Error(`Missing required PLY properties: ${missing.join(", ")}`);

  const report: ParseReport = {
    inputCount: vertexCount,
    retainedCount: 0,
    rejectedOpacity: 0,
    rejectedNonFinite: 0,
    warnings: [],
  };
  const gaussians: Gaussian[] = [];
  const records: Gaussian[] = [];
  if (format === "ascii") {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(
      bytes.slice(dataOffset),
    );
    const rows = text.split(/\r?\n/).filter((row) => row.trim().length > 0);
    if (rows.length < vertexCount)
      throw new Error(
        `PLY is truncated: found ${rows.length} vertices, expected ${vertexCount}`,
      );
    for (let row = 0; row < vertexCount; row += 1) {
      const values = rows[row].trim().split(/\s+/).map(Number);
      if (values.length < properties.length)
        throw new Error(
          `PLY vertex ${row} has ${values.length} values; expected ${properties.length}`,
        );
      const record: Record<string, number> = {};
      properties.forEach((property, i) => {
        record[property.name] = values[i];
      });
      try {
        records.push(activate(record, row));
      } catch (error) {
        report.rejectedNonFinite += 1;
        throw error;
      }
    }
  } else {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let offset = dataOffset;
    for (let row = 0; row < vertexCount; row += 1) {
      const record: Record<string, number> = {};
      for (const property of properties) {
        const size = SCALAR_TYPES[property.type].size;
        if (offset + size > view.byteLength)
          throw new Error(`PLY is truncated at vertex ${row}`);
        record[property.name] = readScalar(view, offset, property.type);
        offset += size;
      }
      try {
        records.push(activate(record, row));
      } catch (error) {
        report.rejectedNonFinite += 1;
        throw error;
      }
    }
  }
  for (const gaussian of records) {
    if (gaussian.opacity < opacityThreshold) {
      report.rejectedOpacity += 1;
      continue;
    }
    gaussians.push(gaussian);
  }
  report.retainedCount = gaussians.length;
  if (!gaussians.length)
    throw new Error(
      `No Gaussians remain after the opacity threshold (${opacityThreshold.toFixed(3)}); lower it or check the PLY`,
    );
  const scales = gaussians.flatMap((g) => g.scale);
  const median =
    [...scales].sort((a, b) => a - b)[Math.floor(scales.length / 2)] ?? 1;
  if (
    scales.filter((s) => s > median * 100).length >
    Math.max(4, gaussians.length * 0.01)
  )
    report.warnings.push(
      "Some Gaussian scales are extreme outliers; automatic bounds may be broad.",
    );
  if (report.rejectedOpacity > report.inputCount * 0.5)
    report.warnings.push(
      `${Math.round((report.rejectedOpacity / report.inputCount) * 100)}% of Gaussians were below the opacity threshold.`,
    );
  return { gaussians, report };
}

export function makeBinaryPly(
  rawRows: Array<Record<string, number>>,
): Uint8Array {
  const names = [
    "x",
    "y",
    "z",
    "opacity",
    "scale_0",
    "scale_1",
    "scale_2",
    "rot_0",
    "rot_1",
    "rot_2",
    "rot_3",
    "f_dc_0",
    "f_dc_1",
    "f_dc_2",
  ];
  const header = `ply\nformat binary_little_endian 1.0\nelement vertex ${rawRows.length}\n${names.map((name) => `property float ${name}`).join("\n")}\nend_header\n`;
  const out = new Uint8Array(header.length + rawRows.length * names.length * 4);
  out.set(new TextEncoder().encode(header));
  const view = new DataView(out.buffer);
  let offset = header.length;
  for (const row of rawRows)
    for (const name of names) {
      view.setFloat32(offset, row[name] ?? 0, true);
      offset += 4;
    }
  return out;
}
