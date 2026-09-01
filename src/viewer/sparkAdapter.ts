import type * as THREE from "three";

export interface SparkHandle {
  object: THREE.Object3D;
  dispose: () => void;
}

/** Optional Spark integration. A failure is deliberately recoverable: the mesh converter does not depend on the preview renderer. */
export async function tryCreateSparkPreview(
  scene: THREE.Object3D,
  bytes: Uint8Array,
  filename: string,
): Promise<SparkHandle> {
  const spark = await import("@sparkjsdev/spark");
  const SplatMesh = spark.SplatMesh;
  if (!SplatMesh) throw new Error("This Spark build does not expose SplatMesh");
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  const object = new SplatMesh({ fileBytes: copy, fileName: filename });
  await object.initialized;
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
      object.dispose();
    },
  };
}
