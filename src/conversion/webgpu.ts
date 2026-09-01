import type { ConversionParams, Gaussian, GridField } from "../types/model";
import {
  buildSpatialIndex,
  densityStats,
  estimateGrid,
  formatMemory,
} from "./engine";

const WORKGROUP_SIZE = 64;

const shader = /* wgsl */ `
struct Gaussian {
  meanOpacity: vec4f,
  scale: vec4f,
  r0: vec4f,
  r1: vec4f,
  r2: vec4f,
}

@group(0) @binding(0) var<storage, read> gaussians: array<Gaussian>;
@group(0) @binding(1) var<storage, read> tileMeta: array<vec4u>;
@group(0) @binding(2) var<storage, read> candidates: array<u32>;
@group(0) @binding(3) var<storage, read> configU: array<u32>;
@group(0) @binding(4) var<storage, read> configF: array<f32>;
@group(0) @binding(5) var<storage, read_write> density: array<f32>;

@compute @workgroup_size(${WORKGROUP_SIZE})
fn main(
  @builtin(workgroup_id) workgroup: vec3u,
  @builtin(local_invocation_id) local: vec3u,
) {
  let id = (workgroup.y * configU[8] + workgroup.x) * ${WORKGROUP_SIZE}u + local.x;
  let voxelCount = configU[7];
  if (id >= voxelCount) { return; }

  let nx = configU[0];
  let ny = configU[1];
  let x = id % nx;
  let y = (id / nx) % ny;
  let z = id / (nx * ny);
  let tileEdge = configU[6];
  let tx = x / tileEdge;
  let ty = y / tileEdge;
  let tz = z / tileEdge;
  let tileId = (tz * configU[4] + ty) * configU[3] + tx;
  let meta = tileMeta[tileId];
  let spacing = configF[3];
  let p = vec3f(
    configF[0] + f32(x) * spacing,
    configF[1] + f32(y) * spacing,
    configF[2] + f32(z) * spacing,
  );
  let sigma2 = configF[4] * configF[4];
  var value = 0.0;
  for (var j = 0u; j < meta.y; j += 1u) {
    let g = gaussians[candidates[meta.x + j]];
    let d = p - g.meanOpacity.xyz;
    let u = vec3f(
      dot(vec3f(g.r0.x, g.r1.x, g.r2.x), d),
      dot(vec3f(g.r0.y, g.r1.y, g.r2.y), d),
      dot(vec3f(g.r0.z, g.r1.z, g.r2.z), d),
    ) / max(g.scale.xyz, vec3f(1e-6));
    let d2 = dot(u, u);
    if (d2 <= sigma2) {
      value += g.meanOpacity.w * exp(-0.5 * d2);
    }
  }
  density[id] = value;
}
`;

export function canUseWebGpu() {
  return typeof navigator !== "undefined" && "gpu" in navigator;
}

function gpuGaussians(gaussians: Gaussian[]) {
  const values = new Float32Array(gaussians.length * 20);
  for (let i = 0; i < gaussians.length; i += 1) {
    const gaussian = gaussians[i];
    const offset = i * 20;
    values.set(gaussian.mean, offset);
    values[offset + 3] = gaussian.opacity;
    values.set(gaussian.scale, offset + 4);
    values.set(gaussian.rotation.slice(0, 3), offset + 8);
    values.set(gaussian.rotation.slice(3, 6), offset + 12);
    values.set(gaussian.rotation.slice(6, 9), offset + 16);
  }
  return values;
}

function createBuffer(
  device: GPUDevice,
  data: Float32Array | Uint32Array,
  usage: GPUBufferUsageFlags,
) {
  const size = Math.max(4, Math.ceil(data.byteLength / 4) * 4);
  const buffer = device.createBuffer({ size, usage, mappedAtCreation: true });
  if (data instanceof Float32Array)
    new Float32Array(buffer.getMappedRange()).set(data);
  else new Uint32Array(buffer.getMappedRange()).set(data);
  buffer.unmap();
  return buffer;
}

export async function voxelizeWebGpu(
  gaussians: Gaussian[],
  params: ConversionParams,
  onProgress?: (percent: number, detail: string) => void,
): Promise<GridField> {
  if (!canUseWebGpu())
    throw new Error("WebGPU is not available in this browser");
  const adapter = await navigator.gpu.requestAdapter({
    powerPreference: "high-performance",
  });
  if (!adapter) throw new Error("No compatible WebGPU adapter is available");
  const device = await adapter.requestDevice();
  const estimate = estimateGrid(gaussians, params);
  if (estimate.bytes > 640 * 1024 * 1024)
    throw new Error(
      `This grid would allocate ${formatMemory(estimate.bytes)}. Lower the resolution or crop the scene.`,
    );
  onProgress?.(0.05, "Building CPU spatial bins for WebGPU");
  const index = buildSpatialIndex(
    gaussians,
    estimate.bounds,
    estimate.spacing,
    estimate.dims,
    params.sigmaRadius,
  );
  const offsets = new Uint32Array(index.buckets.length * 4);
  const candidateCount = index.buckets.reduce(
    (total, bucket) => total + bucket.length,
    0,
  );
  const candidateData = new Uint32Array(Math.max(1, candidateCount));
  let candidateOffset = 0;
  for (let i = 0; i < index.buckets.length; i += 1) {
    const bucket = index.buckets[i];
    offsets[i * 4] = candidateOffset;
    offsets[i * 4 + 1] = bucket.length;
    candidateData.set(bucket, candidateOffset);
    candidateOffset += bucket.length;
  }
  const gaussianData = gpuGaussians(gaussians);
  for (const [label, bytes] of [
    ["Gaussian", gaussianData.byteLength],
    ["spatial tile", offsets.byteLength],
    ["spatial candidate", candidateData.byteLength],
    ["density", estimate.bytes],
  ] as const)
    if (
      bytes > device.limits.maxStorageBufferBindingSize ||
      bytes > device.limits.maxBufferSize
    ) {
      device.destroy();
      throw new Error(
        `${label} buffer requires ${formatMemory(bytes)}, exceeding this WebGPU device limit.`,
      );
    }

  const workgroups = Math.ceil(estimate.voxels / WORKGROUP_SIZE);
  const workgroupsX = Math.min(
    workgroups,
    device.limits.maxComputeWorkgroupsPerDimension,
  );
  const workgroupsY = Math.ceil(workgroups / workgroupsX);
  if (workgroupsY > device.limits.maxComputeWorkgroupsPerDimension) {
    device.destroy();
    throw new Error("The requested grid exceeds WebGPU dispatch limits");
  }
  const configU = new Uint32Array([
    ...estimate.dims,
    ...index.tileDims,
    index.tileEdge,
    estimate.voxels,
    workgroupsX,
  ]);
  const configF = new Float32Array([
    ...estimate.bounds.min,
    estimate.spacing,
    params.sigmaRadius,
  ]);
  const buffers: GPUBuffer[] = [];
  try {
    const storageRead = GPUBufferUsage.STORAGE;
    const gaussianBuffer = createBuffer(device, gaussianData, storageRead);
    const tileBuffer = createBuffer(device, offsets, storageRead);
    const candidateBuffer = createBuffer(device, candidateData, storageRead);
    const configUBuffer = createBuffer(device, configU, storageRead);
    const configFBuffer = createBuffer(device, configF, storageRead);
    const densityBuffer = device.createBuffer({
      size: estimate.bytes,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
    });
    const readBuffer = device.createBuffer({
      size: estimate.bytes,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });
    buffers.push(
      gaussianBuffer,
      tileBuffer,
      candidateBuffer,
      configUBuffer,
      configFBuffer,
      densityBuffer,
      readBuffer,
    );
    const module = device.createShaderModule({ code: shader });
    const pipeline = await device.createComputePipelineAsync({
      layout: "auto",
      compute: { module, entryPoint: "main" },
    });
    const bindGroup = device.createBindGroup({
      layout: pipeline.getBindGroupLayout(0),
      entries: [
        gaussianBuffer,
        tileBuffer,
        candidateBuffer,
        configUBuffer,
        configFBuffer,
        densityBuffer,
      ].map((buffer, binding) => ({ binding, resource: { buffer } })),
    });
    onProgress?.(0.35, "Evaluating density field on WebGPU");
    const encoder = device.createCommandEncoder();
    const pass = encoder.beginComputePass();
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, bindGroup);
    pass.dispatchWorkgroups(workgroupsX, workgroupsY);
    pass.end();
    encoder.copyBufferToBuffer(densityBuffer, 0, readBuffer, 0, estimate.bytes);
    device.queue.submit([encoder.finish()]);
    await readBuffer.mapAsync(GPUMapMode.READ);
    const density = new Float32Array(readBuffer.getMappedRange()).slice();
    readBuffer.unmap();
    onProgress?.(1, "WebGPU density field ready");
    return {
      dims: estimate.dims,
      min: estimate.bounds.min,
      max: estimate.bounds.max,
      spacing: estimate.spacing,
      density,
      stats: densityStats(density),
      index,
    };
  } finally {
    for (const buffer of buffers) buffer.destroy();
    device.destroy();
  }
}
