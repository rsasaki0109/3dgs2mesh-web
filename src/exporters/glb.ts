import * as THREE from "three";
import { GLTFExporter } from "three/examples/jsm/exporters/GLTFExporter.js";
import type { MeshData } from "../types/model";

export function meshToGlb(mesh: MeshData): Promise<Blob> {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.BufferAttribute(mesh.positions, 3),
  );
  geometry.setAttribute("normal", new THREE.BufferAttribute(mesh.normals, 3));
  geometry.setAttribute("color", new THREE.BufferAttribute(mesh.colors, 3));
  geometry.setIndex(new THREE.BufferAttribute(mesh.indices, 1));
  geometry.computeBoundingSphere();
  const material = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.75,
    metalness: 0.05,
    side: THREE.DoubleSide,
  });
  const object = new THREE.Mesh(geometry, material);
  object.name = "3DGS2Mesh";
  return new Promise((resolve, reject) => {
    new GLTFExporter().parse(
      object,
      (result) => {
        const data = result as ArrayBuffer;
        resolve(new Blob([data], { type: "model/gltf-binary" }));
      },
      (error) =>
        reject(error instanceof Error ? error : new Error(String(error))),
      { binary: true, trs: false, onlyVisible: true },
    );
  });
}
