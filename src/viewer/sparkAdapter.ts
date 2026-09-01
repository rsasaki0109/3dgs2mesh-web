import type * as THREE from "three";

export interface SparkHandle {
  object: THREE.Object3D;
  dispose: () => void;
}

/** Optional Spark integration. A failure is deliberately recoverable: the mesh converter does not depend on the preview renderer. */
export async function tryCreateSparkPreview(
  scene: THREE.Object3D,
  bytes: Uint8Array,
): Promise<SparkHandle> {
  const spark = await import("@sparkjsdev/spark");
  const SplatMesh = (
    spark as unknown as {
      SplatMesh?: new (options?: Record<string, unknown>) => THREE.Object3D;
    }
  ).SplatMesh;
  if (!SplatMesh) throw new Error("This Spark build does not expose SplatMesh");
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  const url = URL.createObjectURL(
    new Blob([copy.buffer], { type: "application/octet-stream" }),
  );
  const object = new SplatMesh({ url });
  scene.add(object);
  return {
    object,
    dispose: () => {
      scene.remove(object);
      object.traverse((child) => {
        const disposable = child as THREE.Object3D & {
          geometry?: THREE.BufferGeometry;
          material?: THREE.Material | THREE.Material[];
        };
        disposable.geometry?.dispose();
        if (Array.isArray(disposable.material))
          disposable.material.forEach((material) => {
            material.dispose();
          });
        else disposable.material?.dispose();
      });
      URL.revokeObjectURL(url);
    },
  };
}
