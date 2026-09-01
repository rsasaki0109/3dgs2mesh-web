import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { MeshData } from "../types/model";
import { type SparkHandle, tryCreateSparkPreview } from "./sparkAdapter";

export type ViewerMode = "splat" | "mesh" | "split";

function disposeObject(object: THREE.Object3D | undefined) {
  if (!object) return;
  object.traverse((child) => {
    const item = child as THREE.Object3D & {
      geometry?: THREE.BufferGeometry;
      material?: THREE.Material | THREE.Material[];
    };
    item.geometry?.dispose();
    if (Array.isArray(item.material))
      item.material.forEach((material) => {
        material.dispose();
      });
    else item.material?.dispose();
  });
}

export class SceneViewer {
  readonly renderer: THREE.WebGLRenderer;
  private readonly scene: THREE.Scene;
  private readonly camera: THREE.PerspectiveCamera;
  private readonly controls: OrbitControls;
  private readonly root = new THREE.Group();
  private readonly meshGroup = new THREE.Group();
  private readonly splatGroup = new THREE.Group();
  private readonly grid: THREE.GridHelper;
  private readonly axes: THREE.AxesHelper;
  private meshObject?: THREE.Mesh;
  private pointsObject?: THREE.Points;
  private sparkHandle?: SparkHandle;
  private cropHelper?: THREE.Box3Helper;
  private mode: ViewerMode = "mesh";
  private frame = 0;
  private resizeObserver: ResizeObserver;
  private vertexColors = true;
  private wireframe = false;
  private flatShading = false;

  constructor(private readonly container: HTMLElement) {
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color("#0a0e16");
    this.camera = new THREE.PerspectiveCamera(45, 1, 0.01, 1000);
    this.camera.position.set(2.4, 1.8, 2.8);
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.enabled = false;
    container.appendChild(this.renderer.domElement);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.scene.add(new THREE.HemisphereLight(0xc9d7ff, 0x19202f, 1.7));
    const key = new THREE.DirectionalLight(0xffffff, 2.2);
    key.position.set(3, 4, 5);
    this.scene.add(key);
    this.scene.add(new THREE.AmbientLight(0x60769b, 0.4));
    this.grid = new THREE.GridHelper(4, 20, 0x36435b, 0x1e2839);
    this.grid.visible = true;
    this.scene.add(this.grid);
    this.axes = new THREE.AxesHelper(1.2);
    this.axes.visible = false;
    this.scene.add(this.axes);
    this.scene.add(this.root);
    this.root.add(this.meshGroup, this.splatGroup);
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.resize();
    this.animate();
  }

  private animate = () => {
    this.frame = requestAnimationFrame(this.animate);
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  };
  private resize() {
    const width = Math.max(1, this.container.clientWidth);
    const height = Math.max(1, this.container.clientHeight);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height, false);
  }
  private updateVisibility() {
    this.meshGroup.visible = this.mode === "mesh" || this.mode === "split";
    this.splatGroup.visible = this.mode === "splat" || this.mode === "split";
    if (this.mode === "split") {
      this.meshGroup.position.x = 0.55;
      this.splatGroup.position.x = -0.55;
    } else {
      this.meshGroup.position.x = 0;
      this.splatGroup.position.x = 0;
    }
  }

  setMesh(mesh: MeshData) {
    if (this.meshObject) this.meshGroup.remove(this.meshObject);
    disposeObject(this.meshObject);
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
      color: 0xffffff,
      vertexColors: this.vertexColors,
      roughness: 0.7,
      metalness: 0.08,
      flatShading: this.flatShading,
      wireframe: this.wireframe,
      side: THREE.DoubleSide,
    });
    this.meshObject = new THREE.Mesh(geometry, material);
    this.meshObject.name = "Generated mesh";
    this.meshGroup.add(this.meshObject);
    this.fitToObject();
    this.updateVisibility();
  }

  async setSplat(
    bytes: Uint8Array,
    filename: string,
    previewPositions: Float32Array,
    previewColors: Float32Array,
  ) {
    if (this.sparkHandle) {
      this.sparkHandle.dispose();
      this.sparkHandle = undefined;
    }
    disposeObject(this.pointsObject);
    this.pointsObject = undefined;
    while (this.splatGroup.children.length)
      this.splatGroup.remove(this.splatGroup.children[0]);
    try {
      this.sparkHandle = await tryCreateSparkPreview(
        this.splatGroup,
        bytes,
        filename,
      );
      this.fitToObject();
      return { spark: true };
    } catch {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute(
        "position",
        new THREE.BufferAttribute(previewPositions, 3),
      );
      geometry.setAttribute(
        "color",
        new THREE.BufferAttribute(previewColors, 3),
      );
      const material = new THREE.PointsMaterial({
        size: 0.025,
        sizeAttenuation: true,
        vertexColors: true,
        transparent: true,
        opacity: 0.85,
      });
      this.pointsObject = new THREE.Points(geometry, material);
      this.splatGroup.add(this.pointsObject);
      this.fitToObject();
      return { spark: false };
    } finally {
      this.updateVisibility();
    }
  }

  setMode(mode: ViewerMode) {
    this.mode = mode;
    this.updateVisibility();
  }
  setGrid(visible: boolean) {
    this.grid.visible = visible;
  }
  setAxes(visible: boolean) {
    this.axes.visible = visible;
  }
  setWireframe(enabled: boolean) {
    this.wireframe = enabled;
    const material = this.meshObject?.material;
    if (material instanceof THREE.Material) {
      (material as THREE.MeshStandardMaterial).wireframe = enabled;
      material.needsUpdate = true;
    }
  }
  setFlatShading(enabled: boolean) {
    this.flatShading = enabled;
    const material = this.meshObject?.material;
    if (material instanceof THREE.MeshStandardMaterial) {
      material.flatShading = enabled;
      material.needsUpdate = true;
    }
  }
  setVertexColors(enabled: boolean) {
    this.vertexColors = enabled;
    const material = this.meshObject?.material;
    if (material instanceof THREE.MeshStandardMaterial) {
      material.vertexColors = enabled;
      material.needsUpdate = true;
    }
  }
  setBackground(light: boolean) {
    this.scene.background = new THREE.Color(light ? "#e9edf4" : "#0a0e16");
  }
  setCropBox(bounds?: {
    min: [number, number, number];
    max: [number, number, number];
  }) {
    if (this.cropHelper) {
      this.scene.remove(this.cropHelper);
      this.cropHelper.geometry.dispose();
      if (Array.isArray(this.cropHelper.material))
        this.cropHelper.material.forEach((material) => {
          material.dispose();
        });
      else this.cropHelper.material.dispose();
      this.cropHelper = undefined;
    }
    if (!bounds) return;
    this.cropHelper = new THREE.Box3Helper(
      new THREE.Box3(
        new THREE.Vector3(...bounds.min),
        new THREE.Vector3(...bounds.max),
      ),
      0x5eead4,
    );
    this.scene.add(this.cropHelper);
  }
  fitToObject() {
    const box = new THREE.Box3();
    if (this.meshObject && this.meshGroup.visible)
      box.expandByObject(this.meshObject);
    if (this.pointsObject && this.splatGroup.visible)
      box.expandByObject(this.pointsObject);
    if (this.sparkHandle?.object && this.splatGroup.visible)
      box.expandByObject(this.sparkHandle.object);
    if (!box.isEmpty()) {
      const center = box.getCenter(new THREE.Vector3());
      const size = box.getSize(new THREE.Vector3());
      const radius = Math.max(size.length() * 0.55, 0.25);
      this.controls.target.copy(center);
      this.camera.position
        .copy(center)
        .add(new THREE.Vector3(radius, radius * 0.7, radius * 1.2));
      this.camera.near = Math.max(radius / 100, 0.001);
      this.camera.far = Math.max(radius * 20, 10);
      this.camera.updateProjectionMatrix();
      this.controls.update();
    }
  }
  resetCamera() {
    this.camera.position.set(2.4, 1.8, 2.8);
    this.controls.target.set(0, 0, 0);
    this.camera.near = 0.01;
    this.camera.far = 1000;
    this.camera.updateProjectionMatrix();
    this.controls.update();
  }
  clear() {
    if (this.meshObject) this.meshGroup.remove(this.meshObject);
    disposeObject(this.meshObject);
    this.meshObject = undefined;
    if (this.pointsObject) this.splatGroup.remove(this.pointsObject);
    disposeObject(this.pointsObject);
    this.pointsObject = undefined;
    this.sparkHandle?.dispose();
    this.sparkHandle = undefined;
    this.setCropBox();
  }
  dispose() {
    cancelAnimationFrame(this.frame);
    this.resizeObserver.disconnect();
    this.controls.dispose();
    this.clear();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
