import { PRESETS } from "../conversion/params";
import type { ConversionParams, PresetName } from "../types/model";

interface Props {
  params: ConversionParams;
  onChange: (params: ConversionParams) => void;
  onPreset: (preset: PresetName) => void;
  disabled?: boolean;
}
export function SettingsPanel({ params, onChange, onPreset, disabled }: Props) {
  const set = <K extends keyof ConversionParams>(
    key: K,
    value: ConversionParams[K],
  ) => onChange({ ...params, [key]: value });
  return (
    <>
      <div className="preset-row">
        <span className="control-label">Resolution preset</span>
        {(["fast", "balanced", "detailed"] as PresetName[]).map((preset) => (
          <button
            key={preset}
            type="button"
            className={`preset ${params.resolution === PRESETS[preset].resolution ? "selected" : ""}`}
            onClick={() => onPreset(preset)}
            disabled={disabled}
          >
            <strong>{preset[0].toUpperCase() + preset.slice(1)}</strong>
            <small>{PRESETS[preset].resolution}³ target</small>
          </button>
        ))}
      </div>
      <details className="advanced">
        <summary>Advanced settings</summary>
        <div className="settings-grid">
          <label>
            Density backend
            <select
              value={params.backend}
              onChange={(event) =>
                set(
                  "backend",
                  event.target.value as ConversionParams["backend"],
                )
              }
              disabled={disabled}
            >
              <option value="auto">Auto (WebGPU preferred)</option>
              <option value="webgpu">WebGPU required</option>
              <option value="wasm">CPU / WASM</option>
            </select>
          </label>
          <label>
            Grid resolution <output>{params.resolution}</output>
            <input
              aria-label="Grid resolution"
              type="range"
              min="32"
              max="256"
              step="1"
              value={params.resolution}
              onChange={(event) =>
                set("resolution", Number(event.target.value))
              }
              disabled={disabled}
            />
          </label>
          <label>
            Opacity threshold{" "}
            <output>{params.opacityThreshold.toFixed(3)}</output>
            <input
              type="range"
              min="0"
              max="0.5"
              step="0.005"
              value={params.opacityThreshold}
              onChange={(event) =>
                set("opacityThreshold", Number(event.target.value))
              }
              disabled={disabled}
            />
          </label>
          <label>
            Sigma radius <output>{params.sigmaRadius.toFixed(1)}</output>
            <input
              type="range"
              min="1"
              max="6"
              step="0.1"
              value={params.sigmaRadius}
              onChange={(event) =>
                set("sigmaRadius", Number(event.target.value))
              }
              disabled={disabled}
            />
          </label>
          <label>
            Bounds quantile <output>{params.boundsQuantile.toFixed(3)}</output>
            <input
              type="range"
              min="0"
              max="0.2"
              step="0.005"
              value={params.boundsQuantile}
              onChange={(event) =>
                set("boundsQuantile", Number(event.target.value))
              }
              disabled={disabled}
            />
          </label>
          <label className="check-label">
            <input
              type="checkbox"
              checked={params.cropEnabled}
              onChange={(event) => set("cropEnabled", event.target.checked)}
              disabled={disabled}
            />{" "}
            Enable crop box
          </label>
          {(["X", "Y", "Z"] as const).map((axis, index) => (
            <fieldset
              className="crop-axis"
              key={axis}
              disabled={disabled || !params.cropEnabled}
            >
              <legend>Crop {axis} range</legend>
              <label>
                Min <output>{Math.round(params.cropMin[index] * 100)}%</output>
                <input
                  aria-label={`Crop ${axis} minimum`}
                  type="range"
                  min="0"
                  max="0.95"
                  step="0.01"
                  value={params.cropMin[index]}
                  onChange={(event) => {
                    const next = [
                      ...params.cropMin,
                    ] as ConversionParams["cropMin"];
                    next[index] = Math.min(
                      Number(event.target.value),
                      params.cropMax[index] - 0.01,
                    );
                    set("cropMin", next);
                  }}
                />
              </label>
              <label>
                Max <output>{Math.round(params.cropMax[index] * 100)}%</output>
                <input
                  aria-label={`Crop ${axis} maximum`}
                  type="range"
                  min="0.05"
                  max="1"
                  step="0.01"
                  value={params.cropMax[index]}
                  onChange={(event) => {
                    const next = [
                      ...params.cropMax,
                    ] as ConversionParams["cropMax"];
                    next[index] = Math.max(
                      Number(event.target.value),
                      params.cropMin[index] + 0.01,
                    );
                    set("cropMax", next);
                  }}
                />
              </label>
            </fieldset>
          ))}
          <label>
            Iso mode
            <select
              value={params.isoMode}
              onChange={(event) =>
                set(
                  "isoMode",
                  event.target.value as ConversionParams["isoMode"],
                )
              }
              disabled={disabled}
            >
              <option value="automatic">Automatic</option>
              <option value="manual">Manual</option>
            </select>
          </label>
          <label>
            Iso threshold <output>{params.isoThreshold.toPrecision(3)}</output>
            <input
              type="range"
              min="0"
              max="2"
              step="0.005"
              value={params.isoThreshold}
              onChange={(event) =>
                set("isoThreshold", Number(event.target.value))
              }
              disabled={disabled || params.isoMode !== "manual"}
            />
          </label>
          <label>
            Minimum component faces{" "}
            <input
              type="number"
              min="1"
              max="100000"
              value={params.minComponentFaces}
              onChange={(event) =>
                set(
                  "minComponentFaces",
                  Math.max(1, Number(event.target.value) || 1),
                )
              }
              disabled={disabled}
            />
          </label>
          <label>
            Smoothing iterations <output>{params.smoothingIterations}</output>
            <input
              aria-label="Smoothing iterations"
              type="range"
              min="0"
              max="5"
              step="1"
              value={params.smoothingIterations}
              onChange={(event) =>
                set("smoothingIterations", Number(event.target.value))
              }
              disabled={disabled}
            />
          </label>
          <label>
            Mesh retention{" "}
            <output>{Math.round(params.decimationRatio * 100)}%</output>
            <input
              aria-label="Mesh retention"
              type="range"
              min="0.1"
              max="1"
              step="0.05"
              value={params.decimationRatio}
              onChange={(event) =>
                set("decimationRatio", Number(event.target.value))
              }
              disabled={disabled}
            />
          </label>
          <label>
            Decimation method
            <select
              value={params.decimationMethod}
              onChange={(event) =>
                set(
                  "decimationMethod",
                  event.target.value as ConversionParams["decimationMethod"],
                )
              }
              disabled={disabled || params.decimationRatio >= 0.999}
            >
              <option value="quadric">Quadric-error guided</option>
              <option value="cluster">Vertex clustering</option>
            </select>
          </label>
          <label>
            Density denoise iterations{" "}
            <output>{params.densityDenoiseIterations}</output>
            <input
              aria-label="Density denoise iterations"
              type="range"
              min="0"
              max="3"
              step="1"
              value={params.densityDenoiseIterations}
              onChange={(event) =>
                set("densityDenoiseIterations", Number(event.target.value))
              }
              disabled={disabled}
            />
          </label>
          <label className="check-label">
            <input
              type="checkbox"
              checked={params.fillEnclosedVoids}
              onChange={(event) =>
                set("fillEnclosedVoids", event.target.checked)
              }
              disabled={disabled}
            />{" "}
            Fill enclosed density voids
          </label>
          <label>
            Fill mesh holes up to{" "}
            <output>
              {params.maxHoleEdges ? `${params.maxHoleEdges} edges` : "Off"}
            </output>
            <input
              aria-label="Fill mesh holes up to"
              type="range"
              min="0"
              max="64"
              step="4"
              value={params.maxHoleEdges}
              onChange={(event) =>
                set("maxHoleEdges", Number(event.target.value))
              }
              disabled={disabled}
            />
          </label>
          <label className="check-label">
            <input
              type="checkbox"
              checked={params.lowMemoryMode}
              onChange={(event) => set("lowMemoryMode", event.target.checked)}
              disabled={disabled}
            />{" "}
            Low-memory slab conversion
          </label>
          <label>
            Slab depth <output>{params.slabDepth} layers</output>
            <input
              aria-label="Slab depth"
              type="range"
              min="8"
              max="64"
              step="4"
              value={params.slabDepth}
              onChange={(event) => set("slabDepth", Number(event.target.value))}
              disabled={disabled || !params.lowMemoryMode}
            />
          </label>
          <label className="check-label">
            <input
              type="checkbox"
              checked={params.keepLargestComponent}
              onChange={(event) =>
                set("keepLargestComponent", event.target.checked)
              }
              disabled={disabled}
            />{" "}
            Keep largest component
          </label>
        </div>
      </details>
    </>
  );
}
