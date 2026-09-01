import { makeBinaryPly } from "../conversion/ply";

export function createSyntheticSample(): Uint8Array {
  // A seeded Fibonacci sphere with three concentric shells. It is small enough for CI,
  // yet includes non-uniform scales, rotations, and DC colors like a real 3DGS export.
  const rows: Array<Record<string, number>> = [];
  let seed = 0x3d9f2a17;
  const random = () => {
    seed = (1664525 * seed + 1013904223) >>> 0;
    return seed / 0x1_0000_0000;
  };
  const golden = Math.PI * (3 - Math.sqrt(5));
  const samples = 180;
  for (let shell = 0; shell < 3; shell += 1) {
    const radius = 0.46 + shell * 0.24;
    for (let i = 0; i < samples; i += 1) {
      const y = 1 - ((i + 0.5) / samples) * 2;
      const ring = Math.sqrt(Math.max(0, 1 - y * y));
      const theta = golden * i + shell * 0.35;
      const x = Math.cos(theta) * ring;
      const z = Math.sin(theta) * ring;
      const jitter = (random() - 0.5) * 0.015;
      const nx = x;
      const ny = y;
      const nz = z;
      const yaw = Math.atan2(nz, nx) + (random() - 0.5) * 0.3;
      const pitch =
        Math.asin(Math.max(-1, Math.min(1, ny))) + (random() - 0.5) * 0.25;
      const roll = (random() - 0.5) * 0.7;
      const cy = Math.cos(yaw * 0.5);
      const sy = Math.sin(yaw * 0.5);
      const cp = Math.cos(pitch * 0.5);
      const sp = Math.sin(pitch * 0.5);
      const cr = Math.cos(roll * 0.5);
      const sr = Math.sin(roll * 0.5);
      const qw = cr * cp * cy + sr * sp * sy;
      const qx = sr * cp * cy - cr * sp * sy;
      const qy = cr * sp * cy + sr * cp * sy;
      const qz = cr * cp * sy - sr * sp * cy;
      const scale = 0.14 + shell * 0.012 + random() * 0.025;
      rows.push({
        x: x * radius + jitter,
        y: y * radius + jitter,
        z: z * radius + jitter,
        opacity: 1.65 + (random() - 0.5) * 0.2,
        scale_0: Math.log(scale * (0.9 + random() * 0.2)),
        scale_1: Math.log(scale * (0.8 + random() * 0.2)),
        scale_2: Math.log(scale * (1.1 + random() * 0.25)),
        rot_0: qw,
        rot_1: qx,
        rot_2: qy,
        rot_3: qz,
        f_dc_0: (x + 1) * 1.6 - 0.8,
        f_dc_1: (y + 1) * 1.6 - 0.8,
        f_dc_2: (z + 1) * 1.6 - 0.8,
      });
    }
  }
  return makeBinaryPly(rows);
}
