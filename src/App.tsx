import { useCallback, useEffect, useRef, useState } from "react";
import { DropZone } from "./components/DropZone";
import { ProgressPanel } from "./components/ProgressPanel";
import { SettingsPanel } from "./components/SettingsPanel";
import { StatsPanel } from "./components/StatsPanel";
import { friendlyError } from "./conversion/errors";
import { DEFAULT_PARAMS, paramsForPreset } from "./conversion/params";
import { decodeSplats } from "./conversion/splats";
import { ConversionWorkerClient } from "./conversion/workerClient";
import { meshToGlb } from "./exporters/glb";
import { outputFilename } from "./exporters/names";
import { downloadBlob, meshToBinaryPly, meshToObj } from "./exporters/ply";
import { createSyntheticSample } from "./samples/synthetic";
import type {
  ConversionParams,
  ConversionStage,
  DensityStats,
  Gaussian,
  MeshData,
  ParseReport,
  PresetName,
} from "./types/model";
import { SceneViewer, type ViewerMode } from "./viewer/viewer";
import "./styles.css";

interface Source {
  name: string;
  size: number;
  bytes: ArrayBuffer;
  report: ParseReport;
  gaussians: Gaussian[];
}
interface Output {
  mesh: MeshData;
  report: ParseReport;
  dims: [number, number, number];
  voxelCount: number;
  gridMemory: number;
  density: DensityStats;
  isoThreshold: number;
  elapsed: Record<string, number>;
  backendUsed: "webgpu" | "wasm";
}

const LARGE_INPUT_BYTES = 100 * 1024 * 1024;
const LARGE_INPUT_GAUSSIANS = 500_000;

export default function App() {
  const viewerHost = useRef<HTMLDivElement>(null);
  const viewer = useRef<SceneViewer | undefined>(undefined);
  const worker = useRef<ConversionWorkerClient | undefined>(undefined);
  const [source, setSource] = useState<Source>();
  const [params, setParams] = useState<ConversionParams>(DEFAULT_PARAMS);
  const [output, setOutput] = useState<Output>();
  const [mode, setMode] = useState<ViewerMode>("mesh");
  const [stage, setStage] = useState<ConversionStage>("parsing");
  const [percent, setPercent] = useState(0);
  const [detail, setDetail] = useState<string>();
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string>();
  const [sparkWarning, setSparkWarning] = useState(false);
  const [lightBackground, setLightBackground] = useState(false);
  const [wireframe, setWireframe] = useState(false);
  const [grid, setGrid] = useState(true);
  const [axes, setAxes] = useState(false);
  const [vertexColors, setVertexColors] = useState(true);
  const [flatShading, setFlatShading] = useState(false);

  useEffect(() => {
    if (!viewerHost.current) return;
    viewer.current = new SceneViewer(viewerHost.current);
    return () => {
      viewer.current?.dispose();
      worker.current?.dispose();
    };
  }, []);

  const loadBytes = useCallback(
    async (
      bytes: Uint8Array | ArrayBuffer,
      name: string,
      size = bytes.byteLength,
    ) => {
      setError(undefined);
      setOutput(undefined);
      try {
        const data =
          bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
        const parsed = await decodeSplats(data, name, params.opacityThreshold);
        const largeInput =
          size >= LARGE_INPUT_BYTES ||
          parsed.report.inputCount >= LARGE_INPUT_GAUSSIANS;
        if (largeInput)
          setParams((current) => paramsForPreset("fast", current));
        const owned = data.slice().buffer as ArrayBuffer;
        setSource({
          name,
          size,
          bytes: owned,
          report: parsed.report,
          gaussians: parsed.gaussians,
        });
        setStage("parsing");
        setPercent(0);
        setDetail(
          `${parsed.report.retainedCount.toLocaleString()} Gaussians ready`,
        );
        const spark = await viewer.current?.setSplat(
          data,
          parsed.gaussians,
          name,
        );
        setSparkWarning(spark ? !spark.spark : false);
        viewer.current?.setMode("splat");
        setMode("splat");
      } catch (caught) {
        setSource(undefined);
        setError(friendlyError(caught));
      }
    },
    [params.opacityThreshold],
  );
  const chooseFile = useCallback(
    (file: File) => {
      void file
        .arrayBuffer()
        .then((bytes) => loadBytes(bytes, file.name, file.size));
    },
    [loadBytes],
  );
  const sample = useCallback(() => {
    const bytes = createSyntheticSample();
    void loadBytes(bytes, "synthetic-sphere.ply", bytes.byteLength);
  }, [loadBytes]);

  const start = useCallback(async () => {
    if (!source || running) return;
    worker.current?.dispose();
    const client = new ConversionWorkerClient();
    worker.current = client;
    setRunning(true);
    setError(undefined);
    setStage("parsing");
    setPercent(0);
    try {
      const result = await client.start(
        source.bytes.slice(0),
        source.name,
        params,
        (event) => {
          setStage(event.stage as ConversionStage);
          setPercent(event.percent);
          setDetail(event.detail);
        },
      );
      setOutput(result);
      setSource((current) =>
        current ? { ...current, report: result.report } : current,
      );
      setStage("ready");
      setPercent(1);
      viewer.current?.setMesh(result.mesh);
      const nextMode = mode === "splat" ? "mesh" : mode;
      viewer.current?.setMode(nextMode);
      setMode(nextMode);
    } catch (caught) {
      if (!/cancel/i.test(String(caught))) setError(friendlyError(caught));
    } finally {
      setRunning(false);
    }
  }, [mode, params, running, source]);
  const reextract = useCallback(async () => {
    if (!worker.current || !output || running) return;
    setRunning(true);
    setError(undefined);
    try {
      const result = await worker.current.extract(
        params,
        params.isoThreshold,
        (event) => {
          setStage(event.stage as ConversionStage);
          setPercent(event.percent);
          setDetail(event.detail);
        },
      );
      setOutput(result);
      viewer.current?.setMesh(result.mesh);
    } catch (caught) {
      setError(friendlyError(caught));
    } finally {
      setRunning(false);
    }
  }, [output, params, running]);
  const cancel = () => {
    worker.current?.cancel();
    worker.current = undefined;
    setRunning(false);
    setStage("parsing");
    setPercent(0);
    setDetail("Cancelled");
  };
  const updateMode = (next: ViewerMode) => {
    setMode(next);
    viewer.current?.setMode(next);
  };
  const downloadGlb = async () => {
    if (!output || !source) return;
    try {
      downloadBlob(
        await meshToGlb(output.mesh),
        outputFilename(source.name, "glb"),
      );
    } catch (caught) {
      setError(friendlyError(caught));
    }
  };
  const downloadPly = () => {
    if (output && source) {
      const bytes = meshToBinaryPly(output.mesh);
      downloadBlob(
        new Blob([bytes.buffer as ArrayBuffer], {
          type: "application/octet-stream",
        }),
        outputFilename(source.name, "ply"),
      );
    }
  };
  const downloadObj = () => {
    if (output && source)
      downloadBlob(
        new Blob([meshToObj(output.mesh)], { type: "text/plain" }),
        outputFilename(source.name, "obj"),
      );
  };

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark">3D</div>
          <div>
            <h1>
              3DGS2Mesh <span>Web</span>
            </h1>
            <p>Approximate density-field reconstruction</p>
          </div>
        </div>
        <div className="top-actions">
          <span className="privacy-badge">
            <i /> Local processing
          </span>
          <a
            href="https://github.com/rsasaki0109/3dgs2mesh-web"
            target="_blank"
            rel="noreferrer"
          >
            GitHub ↗
          </a>
        </div>
      </header>
      <main className="workspace">
        <aside className="control-column">
          <section className="intro">
            <span className="eyebrow">BROWSER TOOL · v0.1.0</span>
            <h2>
              Turn splats into <em>editable geometry.</em>
            </h2>
            <p>
              Convert PLY, SPZ, SPLAT, KSPLAT, or packaged SOG into a colored
              triangle mesh on your device. No upload, CUDA, or native install.
            </p>
          </section>
          <section className="card source-card">
            <div className="section-heading">
              <span>01</span>
              <h3>Load Gaussian splats</h3>
            </div>
            <DropZone
              onFile={chooseFile}
              onSample={sample}
              disabled={running}
            />
            {source && (
              <div className="file-chip">
                <span className="file-type">
                  {source.report.sourceFormat?.toUpperCase() ?? "3DGS"}
                </span>
                <div>
                  <strong>{source.name}</strong>
                  <small>
                    {formatFileSize(source.size)} ·{" "}
                    {source.report.inputCount.toLocaleString()} source Gaussians
                  </small>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    viewer.current?.clear();
                    setSource(undefined);
                    setOutput(undefined);
                  }}
                  aria-label="Remove loaded file"
                  disabled={running}
                >
                  ×
                </button>
              </div>
            )}
          </section>
          <section className="card settings-card">
            <div className="section-heading">
              <span>02</span>
              <h3>Conversion settings</h3>
            </div>
            <SettingsPanel
              params={params}
              onChange={setParams}
              onPreset={(preset: PresetName) =>
                setParams(paramsForPreset(preset, params))
              }
              disabled={running}
            />
            <div className="action-row">
              {running ? (
                <button
                  className="button danger"
                  type="button"
                  onClick={cancel}
                >
                  Cancel conversion
                </button>
              ) : (
                <button
                  className="button primary"
                  type="button"
                  onClick={() => void start()}
                  disabled={!source}
                >
                  Convert to mesh <span>→</span>
                </button>
              )}
              {output && params.isoMode === "manual" && !running && (
                <button
                  className="button subtle"
                  type="button"
                  onClick={() => void reextract()}
                >
                  Re-extract iso-surface
                </button>
              )}
            </div>
            <p className="fine-print">
              WebGPU accelerates density sampling when available; CPU/WASM is
              the automatic fallback. The grid is stored as Float32 values.
            </p>
          </section>
          <ProgressPanel
            stage={stage}
            percent={percent}
            detail={detail}
            running={running}
          />
          {error && (
            <div className="error-box" role="alert">
              <strong>Could not complete this step</strong>
              <span>{error}</span>
            </div>
          )}
          {source &&
            (source.report.warnings.length > 0 ||
              source.size >= LARGE_INPUT_BYTES ||
              source.report.inputCount >= LARGE_INPUT_GAUSSIANS) && (
              <div className="warning-box" role="status">
                <strong>Input inspection warning</strong>
                {(source.size >= LARGE_INPUT_BYTES ||
                  source.report.inputCount >= LARGE_INPUT_GAUSSIANS) && (
                  <span>
                    This {formatFileSize(source.size)} source is large, so Fast
                    was selected automatically. Parsing, spatial bins, preview
                    data, and mesh buffers require memory in addition to the
                    density grid.
                  </span>
                )}
                {source.report.warnings.map((warning) => (
                  <span key={warning}>{warning}</span>
                ))}
              </div>
            )}
          {sparkWarning && (
            <div className="warning-box">
              <strong>Splat preview fallback</strong>
              <span>
                Spark could not initialize on this device. Mesh conversion
                remains available.
              </span>
            </div>
          )}
          <section className="privacy-note">
            <span className="lock">⌂</span>
            <p>
              <strong>Your file stays here.</strong> Nothing is sent to a
              server. Preview, conversion, and downloads all stay local.
            </p>
          </section>
        </aside>
        <section className="viewer-column">
          <div className="viewer-toolbar">
            <div className="tabs" role="tablist" aria-label="Viewer mode">
              {(
                [
                  ["splat", "Original Splat"],
                  ["mesh", "Generated Mesh"],
                  ["split", "Split comparison"],
                ] as [ViewerMode, string][]
              ).map(([value, label]) => (
                <button
                  key={value}
                  role="tab"
                  aria-selected={mode === value}
                  className={mode === value ? "active" : ""}
                  type="button"
                  onClick={() => updateMode(value)}
                  disabled={!source || (value !== "splat" && !output)}
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="viewer-tools">
              <button
                type="button"
                onClick={() => {
                  setGrid((value) => !value);
                  viewer.current?.setGrid(!grid);
                }}
                aria-label="Toggle grid"
                className={grid ? "tool active" : "tool"}
              >
                ▦
              </button>
              <button
                type="button"
                onClick={() => {
                  setAxes((value) => !value);
                  viewer.current?.setAxes(!axes);
                }}
                aria-label="Toggle axes"
                className={axes ? "tool active" : "tool"}
              >
                ⌖
              </button>
              <button
                type="button"
                onClick={() => {
                  setVertexColors((value) => !value);
                  viewer.current?.setVertexColors(!vertexColors);
                }}
                aria-label="Toggle vertex colors"
                className={vertexColors ? "tool active" : "tool"}
              >
                ●
              </button>
              <button
                type="button"
                onClick={() => {
                  setWireframe((value) => !value);
                  viewer.current?.setWireframe(!wireframe);
                }}
                aria-label="Toggle wireframe"
                className={wireframe ? "tool active" : "tool"}
              >
                ◇
              </button>
              <button
                type="button"
                onClick={() => {
                  setFlatShading((value) => !value);
                  viewer.current?.setFlatShading(!flatShading);
                }}
                aria-label="Toggle flat shading"
                className={flatShading ? "tool active" : "tool"}
              >
                ▤
              </button>
              <button
                type="button"
                onClick={() => {
                  setLightBackground((value) => !value);
                  viewer.current?.setBackground(!lightBackground);
                }}
                aria-label="Toggle background"
                className="tool"
              >
                ◐
              </button>
              <button
                type="button"
                onClick={() => viewer.current?.fitToObject()}
                className="tool text-tool"
              >
                Fit
              </button>
              <button
                type="button"
                onClick={() => viewer.current?.resetCamera()}
                className="tool text-tool"
              >
                Reset
              </button>
            </div>
          </div>
          <div className="canvas-frame">
            <div ref={viewerHost} className="viewer-canvas" />
            <div className={`empty-view${source ? " has-source" : ""}`}>
              {!source && (
                <>
                  <div className="empty-glyph">✦</div>
                  <h3>Your mesh workspace</h3>
                  <p>Load a 3DGS asset or try the synthetic sphere to begin.</p>
                </>
              )}
              {source && !output && (
                <>
                  <div className="empty-glyph pulse">◌</div>
                  <h3>Ready to convert</h3>
                  <p>Choose a preset, then run the conversion.</p>
                </>
              )}
            </div>
            <div className="canvas-label">
              {mode === "splat"
                ? "Gaussian preview"
                : mode === "mesh"
                  ? "Editable mesh"
                  : "Comparison"}
              <span>Orbit · Pan · Scroll</span>
            </div>
          </div>
          <div className="viewer-bottom">
            <StatsPanel
              fileSize={source?.size ?? 0}
              report={output?.report ?? source?.report}
              dims={output?.dims}
              voxelCount={output?.voxelCount}
              gridMemory={output?.gridMemory}
              density={output?.density}
              vertexCount={
                output?.mesh.positions.length
                  ? output.mesh.positions.length / 3
                  : undefined
              }
              triangleCount={
                output?.mesh.indices.length
                  ? output.mesh.indices.length / 3
                  : undefined
              }
              elapsed={output?.elapsed}
              backendUsed={output?.backendUsed}
            />
            <section className="export-card">
              <div className="section-heading">
                <span>03</span>
                <h3>Export editable mesh</h3>
              </div>
              <p>
                Static vertex colors from SH DC only. View-dependent appearance
                is not preserved.
              </p>
              <div className="export-buttons">
                <button
                  className="button export"
                  type="button"
                  onClick={() => void downloadGlb()}
                  disabled={!output}
                >
                  Download GLB <span>↗</span>
                </button>
                <button
                  className="button export"
                  type="button"
                  onClick={downloadPly}
                  disabled={!output}
                >
                  Binary PLY <span>↗</span>
                </button>
                <button
                  className="button export secondary"
                  type="button"
                  onClick={downloadObj}
                  disabled={!output}
                >
                  OBJ <span>↗</span>
                </button>
              </div>
            </section>
          </div>
        </section>
      </main>
      <footer>
        <span>3DGS2Mesh Web is an independent Apache-2.0 OSS project.</span>
        <span>
          Approximate reconstruction · no guaranteed watertight output
        </span>
      </footer>
    </div>
  );
}

function formatFileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / 1024 ** 2).toFixed(1)} MiB`;
}
