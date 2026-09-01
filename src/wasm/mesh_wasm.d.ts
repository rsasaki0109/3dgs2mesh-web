/* tslint:disable */
/* eslint-disable */

export class ConversionSession {
    free(): void;
    [Symbol.dispose](): void;
    density_stats(): string;
    extract_mesh(keep_largest: boolean, min_component_faces: number, smoothing_iterations: number): void;
    free(): void;
    /**
     * Creates a session from activated Gaussian data decoded by a compatible
     * browser format loader. Each row contains mean(3), scale(3), a row-major
     * rotation matrix(9), opacity(1), and linear RGB(3).
     */
    static fromActivated(data: Float32Array, resolution: number, opacity_threshold: number, sigma_radius: number, bounds_quantile: number): ConversionSession;
    grid_dimensions(): Uint32Array;
    grid_memory_bytes(): number;
    mesh_colors(): Float32Array;
    mesh_indices(): Uint32Array;
    mesh_normals(): Float32Array;
    mesh_ply(): Uint8Array;
    mesh_positions(): Float32Array;
    metadata(): string;
    constructor(bytes: Uint8Array, resolution: number, opacity_threshold: number, sigma_radius: number, bounds_quantile: number);
    set_iso_threshold(iso: number): void;
    triangle_count(): number;
    vertex_count(): number;
    voxelize(): void;
}

export function start(): void;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly __wbg_conversionsession_free: (a: number, b: number) => void;
    readonly conversionsession_density_stats: (a: number) => [number, number, number, number];
    readonly conversionsession_extract_mesh: (a: number, b: number, c: number, d: number) => [number, number];
    readonly conversionsession_free: (a: number) => void;
    readonly conversionsession_fromActivated: (a: number, b: number, c: number, d: number, e: number, f: number) => [number, number, number];
    readonly conversionsession_grid_dimensions: (a: number) => [number, number, number];
    readonly conversionsession_grid_memory_bytes: (a: number) => [number, number, number];
    readonly conversionsession_mesh_colors: (a: number) => [number, number, number];
    readonly conversionsession_mesh_indices: (a: number) => [number, number, number];
    readonly conversionsession_mesh_normals: (a: number) => [number, number, number];
    readonly conversionsession_mesh_ply: (a: number) => [number, number, number];
    readonly conversionsession_mesh_positions: (a: number) => [number, number, number];
    readonly conversionsession_metadata: (a: number) => [number, number];
    readonly conversionsession_new: (a: number, b: number, c: number, d: number, e: number, f: number) => [number, number, number];
    readonly conversionsession_set_iso_threshold: (a: number, b: number) => [number, number];
    readonly conversionsession_triangle_count: (a: number) => [number, number, number];
    readonly conversionsession_vertex_count: (a: number) => [number, number, number];
    readonly conversionsession_voxelize: (a: number) => [number, number];
    readonly start: () => void;
    readonly __wbindgen_free: (a: number, b: number, c: number) => void;
    readonly __wbindgen_malloc: (a: number, b: number) => number;
    readonly __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
    readonly __wbindgen_externrefs: WebAssembly.Table;
    readonly __externref_table_dealloc: (a: number) => void;
    readonly __wbindgen_start: () => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
 * Instantiates the given `module`, which can either be bytes or
 * a precompiled `WebAssembly.Module`.
 *
 * @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
 *
 * @returns {InitOutput}
 */
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
 * If `module_or_path` is {RequestInfo} or {URL}, makes a request and
 * for everything else, calls `WebAssembly.instantiate` directly.
 *
 * @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
 *
 * @returns {Promise<InitOutput>}
 */
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
