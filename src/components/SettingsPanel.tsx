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
