import type { ChangeEvent, DragEvent } from "react";

interface Props {
  onFile: (file: File) => void;
  onSample: () => void;
  disabled?: boolean;
}

export function DropZone({ onFile, onSample, disabled = false }: Props) {
  const pick = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) onFile(file);
    event.target.value = "";
  };
  const drop = (event: DragEvent<HTMLLabelElement>) => {
    event.preventDefault();
    const file = event.dataTransfer.files?.[0];
    if (file) onFile(file);
  };
  return (
    <div className="drop-wrap">
      <label
        className={`drop-zone${disabled ? " is-disabled" : ""}`}
        onDragOver={(event) => event.preventDefault()}
        onDrop={drop}
      >
        <input
          aria-label="Choose a 3DGS file"
          type="file"
          accept=".ply,.spz,.splat,.ksplat,.sog,.zip,application/octet-stream,application/zip"
          onChange={pick}
          disabled={disabled}
        />
        <span className="drop-icon">＋</span>
        <span className="drop-title">Drop a 3DGS file here</span>
        <span className="drop-subtitle">
          PLY · SPZ · SPLAT · KSPLAT · SOG/ZIP · processed locally
        </span>
        <span className="file-button">Choose 3DGS file</span>
      </label>
      <button
        className="sample-button"
        type="button"
        onClick={onSample}
        disabled={disabled}
      >
        Load deterministic sample <span>↗</span>
      </button>
    </div>
  );
}
