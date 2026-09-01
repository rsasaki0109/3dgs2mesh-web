declare module "@sparkjsdev/spark" {
  export const SparkRenderer: new (
    options?: Record<string, unknown>,
  ) => unknown;
  export const SplatMesh: new (options?: Record<string, unknown>) => unknown;
  export const SparkControls: new (
    camera: unknown,
    element?: unknown,
  ) => unknown;
  const spark: Record<string, unknown>;
  export default spark;
}
