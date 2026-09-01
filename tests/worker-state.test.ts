import { describe, expect, it } from "vitest";
import {
  initialWorkerUiState,
  reduceWorkerMessage,
} from "../src/conversion/workerState";

describe("worker UI state", () => {
  it("moves through progress and ready states", () => {
    const parsing = reduceWorkerMessage(initialWorkerUiState, {
      type: "progress",
      id: 1,
      stage: "voxelizing",
      percent: 0.5,
      detail: "slice 4/8",
    });
    expect(parsing.running).toBe(true);
    expect(parsing.stage).toBe("voxelizing");
    const ready = reduceWorkerMessage(parsing, {
      type: "ready",
      id: 1,
      result: {} as never,
    });
    expect(ready.running).toBe(false);
    expect(ready.percent).toBe(1);
  });
  it("surfaces worker errors", () => {
    const state = reduceWorkerMessage(initialWorkerUiState, {
      type: "error",
      id: 1,
      message: "PLY is truncated",
    });
    expect(state.error).toBe("PLY is truncated");
    expect(state.running).toBe(false);
  });
});
