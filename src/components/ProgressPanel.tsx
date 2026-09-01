import type { ConversionStage } from "../types/model";

const stages: Array<[ConversionStage, string]> = [
  ["parsing", "Parsing PLY"],
  ["activating", "Activating Gaussian parameters"],
  ["indexing", "Building spatial index"],
  ["voxelizing", "Voxelizing density field"],
  ["extracting", "Extracting iso-surface"],
  ["cleaning", "Cleaning mesh"],
  ["normals", "Computing normals & colors"],
  ["ready", "Ready"],
];
interface Props {
  stage: ConversionStage;
  percent: number;
  detail?: string;
  running: boolean;
}
export function ProgressPanel({ stage, percent, detail, running }: Props) {
  const active = stages.findIndex(([name]) => name === stage);
  return (
    <div
      data-testid={stage === "ready" ? "ready-state" : "progress-state"}
      className={`progress-panel${running ? " is-running" : ""}`}
      aria-live="polite"
    >
      <div className="progress-heading">
        <span>{stages[Math.max(0, active)]?.[1] ?? "Ready"}</span>
        <span>
          {running
            ? `${Math.round(percent * 100)}%`
            : stage === "ready"
              ? "Done"
              : "Idle"}
        </span>
      </div>
      <div className="progress-track">
        <span
          style={{ width: `${Math.max(0, Math.min(100, percent * 100))}%` }}
        />
      </div>
      <div className="progress-steps">
        {stages.map(([name, label], index) => (
          <span
            key={name}
            className={
              index < active || stage === "ready"
                ? "done"
                : index === active
                  ? "current"
                  : ""
            }
          >
            <i />
            {label}
          </span>
        ))}
      </div>
      {detail && <p className="progress-detail">{detail}</p>}
    </div>
  );
}
