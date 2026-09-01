import type {
  ConversionParams,
  WorkerReadyMessage,
  WorkerResponse,
} from "../types/model";

export interface ProgressEvent {
  stage: string;
  percent: number;
  detail?: string;
  elapsed?: number;
}

export class ConversionWorkerClient {
  private worker: Worker;
  private sequence = 0;
  private pending = new Map<
    number,
    {
      resolve: (value: WorkerReadyMessage["result"]) => void;
      reject: (reason: Error) => void;
      progress?: (event: ProgressEvent) => void;
    }
  >();

  constructor() {
    this.worker = this.createWorker();
  }

  private createWorker() {
    const worker = new Worker(
      new URL("../workers/conversion.worker.ts", import.meta.url),
      { type: "module" },
    );
    worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      const response = event.data;
      const current = this.pending.get(response.id);
      if (!current) return;
      if (response.type === "progress") current.progress?.(response);
      else if (response.type === "ready") {
        this.pending.delete(response.id);
        current.resolve(response.result);
      } else {
        this.pending.delete(response.id);
        current.reject(new Error(response.message));
      }
    };
    worker.onerror = (event) => {
      for (const [id, current] of this.pending) {
        current.reject(new Error(event.message || "Conversion worker failed"));
        this.pending.delete(id);
      }
    };
    return worker;
  }

  start(
    bytes: ArrayBuffer,
    params: ConversionParams,
    progress?: (event: ProgressEvent) => void,
  ) {
    const id = ++this.sequence;
    return new Promise<WorkerReadyMessage["result"]>((resolve, reject) => {
      this.pending.set(id, { resolve, reject, progress });
      this.worker.postMessage({ type: "start", id, bytes, params }, [bytes]);
    });
  }

  extract(
    params: ConversionParams,
    isoThreshold: number,
    progress?: (event: ProgressEvent) => void,
  ) {
    const id = ++this.sequence;
    return new Promise<WorkerReadyMessage["result"]>((resolve, reject) => {
      this.pending.set(id, { resolve, reject, progress });
      this.worker.postMessage({ type: "extract", id, params, isoThreshold });
    });
  }

  cancel() {
    this.worker.postMessage({ type: "cancel" });
    this.worker.terminate();
    this.worker = this.createWorker();
    this.pending.clear();
  }
  dispose() {
    this.worker.terminate();
    this.pending.clear();
  }
}
