import type { GridField, MeshData } from "../types/model";
import { densityStats, recomputeNormals } from "./engine";

const voxelIndex = (
  dims: [number, number, number],
  x: number,
  y: number,
  z: number,
) => (z * dims[1] + y) * dims[0] + x;

export interface DensityProcessingResult {
  field: GridField;
  extractionIso: number;
  denoisedVoxels: number;
  enclosedVoxelsFilled: number;
}

/** Binary-domain cleanup while retaining the original scalar values wherever possible. */
export function processDensityField(
  field: GridField,
  iso: number,
  denoiseIterations: number,
  fillEnclosedVoids: boolean,
  distanceBandVoxels = 0,
): DensityProcessingResult {
  if (denoiseIterations <= 0 && !fillEnclosedVoids && distanceBandVoxels <= 0)
    return {
      field,
      extractionIso: iso,
      denoisedVoxels: 0,
      enclosedVoxelsFilled: 0,
    };
  const density = field.density.slice();
  const [nx, ny, nz] = field.dims;
  const occupied = new Uint8Array(density.length);
  for (let i = 0; i < density.length; i += 1)
    occupied[i] = density[i] >= iso ? 1 : 0;
  const neighbours = [
    [-1, 0, 0],
    [1, 0, 0],
    [0, -1, 0],
    [0, 1, 0],
    [0, 0, -1],
    [0, 0, 1],
  ] as const;
  let denoisedVoxels = 0;
  for (let iteration = 0; iteration < denoiseIterations; iteration += 1) {
    const next = occupied.slice();
    for (let z = 1; z < nz - 1; z += 1)
      for (let y = 1; y < ny - 1; y += 1)
        for (let x = 1; x < nx - 1; x += 1) {
          const id = voxelIndex(field.dims, x, y, z);
          let count = 0;
          for (const [dx, dy, dz] of neighbours)
            count += occupied[voxelIndex(field.dims, x + dx, y + dy, z + dz)];
          const value = occupied[id]
            ? count <= 1
              ? 0
              : 1
            : count >= 5
              ? 1
              : 0;
          if (value !== occupied[id]) denoisedVoxels += 1;
          next[id] = value;
        }
    occupied.set(next);
  }
  const epsilon = Math.max(1e-6, Math.abs(iso) * 1e-4);
  for (let i = 0; i < density.length; i += 1) {
    const isOccupied = density[i] >= iso;
    if (occupied[i] !== Number(isOccupied))
      density[i] = occupied[i] ? iso + epsilon : Math.max(0, iso - epsilon);
  }

  let enclosedVoxelsFilled = 0;
  if (fillEnclosedVoids) {
    const exterior = new Uint8Array(density.length);
    const queue = new Uint32Array(density.length);
    let head = 0;
    let tail = 0;
    const enqueue = (x: number, y: number, z: number) => {
      const id = voxelIndex(field.dims, x, y, z);
      if (occupied[id] || exterior[id]) return;
      exterior[id] = 1;
      queue[tail++] = id;
    };
    for (let z = 0; z < nz; z += 1)
      for (let y = 0; y < ny; y += 1) {
        enqueue(0, y, z);
        enqueue(nx - 1, y, z);
      }
    for (let z = 0; z < nz; z += 1)
      for (let x = 0; x < nx; x += 1) {
        enqueue(x, 0, z);
        enqueue(x, ny - 1, z);
      }
    for (let y = 0; y < ny; y += 1)
      for (let x = 0; x < nx; x += 1) {
        enqueue(x, y, 0);
        enqueue(x, y, nz - 1);
      }
    while (head < tail) {
      const id = queue[head++];
      const x = id % nx;
      const y = Math.floor(id / nx) % ny;
      const z = Math.floor(id / (nx * ny));
      for (const [dx, dy, dz] of neighbours) {
        const px = x + dx;
        const py = y + dy;
        const pz = z + dz;
        if (px >= 0 && py >= 0 && pz >= 0 && px < nx && py < ny && pz < nz)
          enqueue(px, py, pz);
      }
    }
    for (let i = 0; i < density.length; i += 1)
      if (!occupied[i] && !exterior[i]) {
        density[i] = iso + epsilon;
        occupied[i] = 1;
        enclosedVoxelsFilled += 1;
      }
  }
  let extractionIso = iso;
  if (distanceBandVoxels > 0) {
    const band = Math.max(2, Math.min(32, Math.round(distanceBandVoxels)));
    const unvisited = 0xffff;
    const distance = new Uint16Array(density.length);
    distance.fill(unvisited);
    const queue = new Uint32Array(density.length);
    let head = 0;
    let tail = 0;
    const globalDims = field.globalDims ?? field.dims;
    const offset = field.gridOffset ?? [0, 0, 0];
    for (let z = 0; z < nz; z += 1)
      for (let y = 0; y < ny; y += 1)
        for (let x = 0; x < nx; x += 1) {
          const id = voxelIndex(field.dims, x, y, z);
          const global = [x + offset[0], y + offset[1], z + offset[2]];
          if (
            global.some(
              (value, axis) => value === 0 || value === globalDims[axis] - 1,
            )
          )
            occupied[id] = 0;
          let interfaceVoxel = false;
          for (const [dx, dy, dz] of neighbours) {
            const px = x + dx;
            const py = y + dy;
            const pz = z + dz;
            if (px < 0 || py < 0 || pz < 0 || px >= nx || py >= ny || pz >= nz)
              continue;
            if (occupied[voxelIndex(field.dims, px, py, pz)] !== occupied[id]) {
              interfaceVoxel = true;
              break;
            }
          }
          if (interfaceVoxel) {
            distance[id] = 0;
            queue[tail++] = id;
          }
        }
    while (head < tail) {
      const id = queue[head++];
      if (distance[id] + 1 >= band) continue;
      const x = id % nx;
      const y = Math.floor(id / nx) % ny;
      const z = Math.floor(id / (nx * ny));
      for (const [dx, dy, dz] of neighbours) {
        const px = x + dx;
        const py = y + dy;
        const pz = z + dz;
        if (px < 0 || py < 0 || pz < 0 || px >= nx || py >= ny || pz >= nz)
          continue;
        const next = voxelIndex(field.dims, px, py, pz);
        if (distance[next] !== unvisited) continue;
        distance[next] = distance[id] + 1;
        queue[tail++] = next;
      }
    }
    for (let i = 0; i < density.length; i += 1) {
      const magnitude =
        distance[i] === unvisited ? band : Math.min(band, distance[i] + 0.5);
      const x = i % nx;
      const y = Math.floor(i / nx) % ny;
      const z = Math.floor(i / (nx * ny));
      const globalIndex =
        ((z + offset[2]) * globalDims[1] + (y + offset[1])) * globalDims[0] +
        x +
        offset[0];
      const jitter =
        (((globalIndex * 1664525 + 1013904223) >>> 0) % 1024) * 1e-7;
      density[i] = occupied[i] ? magnitude + jitter : -magnitude - jitter;
    }
    extractionIso = 0;
  }
  return {
    field: { ...field, density, stats: densityStats(density) },
    extractionIso,
    denoisedVoxels,
    enclosedVoxelsFilled,
  };
}

/** Caps simple, unbranched boundary loops using a color-averaged center fan. */
export function fillSmallBoundaryHoles(
  mesh: MeshData,
  maxEdges: number,
): { mesh: MeshData; holesFilled: number } {
  if (maxEdges < 3 || mesh.indices.length < 3) return { mesh, holesFilled: 0 };
  const edges = new Map<string, { count: number; a: number; b: number }>();
  for (let i = 0; i < mesh.indices.length; i += 3)
    for (const [a, b] of [
      [mesh.indices[i], mesh.indices[i + 1]],
      [mesh.indices[i + 1], mesh.indices[i + 2]],
      [mesh.indices[i + 2], mesh.indices[i]],
    ]) {
      const key = a < b ? `${a}:${b}` : `${b}:${a}`;
      const edge = edges.get(key);
      if (edge) edge.count += 1;
      else edges.set(key, { count: 1, a, b });
    }
  const outgoing = new Map<number, number[]>();
  for (const edge of edges.values())
    if (edge.count === 1) {
      const list = outgoing.get(edge.a) ?? [];
      list.push(edge.b);
      outgoing.set(edge.a, list);
    }
  for (const values of outgoing.values()) values.sort((a, b) => a - b);
  const used = new Set<string>();
  const positions = [...mesh.positions];
  const colors = [...mesh.colors];
  const indices = [...mesh.indices];
  let holesFilled = 0;
  for (const [start, candidates] of [...outgoing.entries()].sort(
    ([a], [b]) => a - b,
  ))
    for (const first of candidates) {
      const firstKey = `${start}:${first}`;
      if (used.has(firstKey)) continue;
      const loop = [start];
      let current = start;
      let next = first;
      const traversed: string[] = [];
      while (loop.length <= maxEdges) {
        traversed.push(`${current}:${next}`);
        if (next === start) break;
        loop.push(next);
        const choices = (outgoing.get(next) ?? []).filter(
          (value) => !used.has(`${next}:${value}`),
        );
        if (choices.length !== 1) break;
        current = next;
        next = choices[0];
      }
      if (next !== start || loop.length < 3 || loop.length > maxEdges) continue;
      traversed.forEach((key) => {
        used.add(key);
      });
      const center = positions.length / 3;
      const p = [0, 0, 0];
      const c = [0, 0, 0];
      for (const vertex of loop)
        for (let axis = 0; axis < 3; axis += 1) {
          p[axis] += positions[vertex * 3 + axis] / loop.length;
          c[axis] += colors[vertex * 3 + axis] / loop.length;
        }
      positions.push(...p);
      colors.push(...c);
      for (let i = 0; i < loop.length; i += 1)
        indices.push(loop[(i + 1) % loop.length], loop[i], center);
      holesFilled += 1;
    }
  if (!holesFilled) return { mesh, holesFilled: 0 };
  const result: MeshData = {
    positions: new Float32Array(positions),
    colors: new Float32Array(colors),
    normals: new Float32Array(positions.length),
    indices: new Uint32Array(indices),
  };
  recomputeNormals(result);
  return { mesh: result, holesFilled };
}
