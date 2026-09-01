import type { MeshData } from "../types/model";

export function meshToBinaryPly(mesh: MeshData): Uint8Array {
  const vertexCount = mesh.positions.length / 3;
  const faceCount = Math.floor(mesh.indices.length / 3);
  const header = `ply\nformat binary_little_endian 1.0\nelement vertex ${vertexCount}\nproperty float x\nproperty float y\nproperty float z\nproperty float nx\nproperty float ny\nproperty float nz\nproperty uchar red\nproperty uchar green\nproperty uchar blue\nelement face ${faceCount}\nproperty list uchar int vertex_indices\nend_header\n`;
  const headerBytes = new TextEncoder().encode(header);
  const out = new Uint8Array(
    headerBytes.length + vertexCount * (6 * 4 + 3) + faceCount * (1 + 3 * 4),
  );
  out.set(headerBytes);
  const view = new DataView(out.buffer);
  let offset = headerBytes.length;
  for (let i = 0; i < vertexCount; i += 1) {
    for (const value of [
      mesh.positions[i * 3],
      mesh.positions[i * 3 + 1],
      mesh.positions[i * 3 + 2],
      mesh.normals[i * 3] ?? 0,
      mesh.normals[i * 3 + 1] ?? 0,
      mesh.normals[i * 3 + 2] ?? 1,
    ]) {
      view.setFloat32(offset, Number.isFinite(value) ? value : 0, true);
      offset += 4;
    }
    for (let c = 0; c < 3; c += 1) {
      const value = Math.max(
        0,
        Math.min(255, Math.round((mesh.colors[i * 3 + c] ?? 0.6) * 255)),
      );
      out[offset] = value;
      offset += 1;
    }
  }
  for (let i = 0; i < faceCount; i += 1) {
    out[offset] = 3;
    offset += 1;
    for (let j = 0; j < 3; j += 1) {
      view.setUint32(offset, mesh.indices[i * 3 + j], true);
      offset += 4;
    }
  }
  return out;
}

export function meshToObj(mesh: MeshData): string {
  const lines = [
    "# 3DGS2Mesh Web OBJ export",
    "# Vertex colors are included after xyz for viewers that support the convention.",
  ];
  for (let i = 0; i < mesh.positions.length; i += 3)
    lines.push(
      `v ${mesh.positions[i]} ${mesh.positions[i + 1]} ${mesh.positions[i + 2]} ${mesh.colors[i] ?? 0.6} ${mesh.colors[i + 1] ?? 0.6} ${mesh.colors[i + 2] ?? 0.6}`,
    );
  for (let i = 0; i < mesh.normals.length; i += 3)
    lines.push(
      `vn ${mesh.normals[i]} ${mesh.normals[i + 1]} ${mesh.normals[i + 2]}`,
    );
  for (let i = 0; i < mesh.indices.length; i += 3) {
    const a = mesh.indices[i] + 1;
    const b = mesh.indices[i + 1] + 1;
    const c = mesh.indices[i + 2] + 1;
    lines.push(`f ${a}//${a} ${b}//${b} ${c}//${c}`);
  }
  return `${lines.join("\n")}\n`;
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}
