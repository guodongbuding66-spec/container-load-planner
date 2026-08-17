/// <reference lib="webworker" />

import { pack } from "./engine";
import type { WorkerRequest, WorkerResponse } from "./types";

self.onmessage = (event: MessageEvent<WorkerRequest>) => {
  const message = event.data;
  if (message.type !== "pack") return;
  try {
    const response: WorkerResponse = {
      type: "result",
      requestId: message.requestId,
      payload: pack(message.payload),
    };
    self.postMessage(response);
  } catch (error) {
    const response: WorkerResponse = {
      type: "error",
      requestId: message.requestId,
      message: error instanceof Error ? error.message : "计算失败，请检查输入。",
    };
    self.postMessage(response);
  }
};

export {};

