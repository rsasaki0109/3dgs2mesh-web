import type { ConversionStage, WorkerResponse } from "../types/model";

export interface WorkerUiState {
  stage: ConversionStage;
  percent: number;
  detail?: string;
  running: boolean;
  error?: string;
}
export const initialWorkerUiState: WorkerUiState = {
  stage: "parsing",
  percent: 0,
  running: false,
};

export function reduceWorkerMessage(
  state: WorkerUiState,
  response: WorkerResponse,
): WorkerUiState {
  if (response.type === "progress")
    return {
      ...state,
      stage: response.stage,
      percent: response.percent,
      detail: response.detail,
      running: response.stage !== "ready",
      error: undefined,
    };
  if (response.type === "ready")
    return {
      ...state,
      stage: "ready",
      percent: 1,
      running: false,
      error: undefined,
    };
  return { ...state, running: false, error: response.message };
}
