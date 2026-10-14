/// <reference lib="webworker" />

import { packLoadingWorkflow } from "./pack-loading";
import type { WorkerRequest, WorkerResponse } from "./types";

self.onmessage = (event: MessageEvent<WorkerRequest>) => {
  const message = event.data;
  if (message.type !== "pack-strategy") return;
  try {
    if (message.payload.mode === "mixed" && (!message.payload.workflow || message.payload.workflow === "direct")) {
      const quick=packLoadingWorkflow({...message.payload,strategy:message.strategy,searchPass:0});
      if(quick.validation.valid)self.postMessage({type:"progress",requestId:message.requestId,strategy:message.strategy,payload:quick});
    }
    const response: WorkerResponse = {
      type: "result",
      requestId: message.requestId,
      strategy: message.strategy,
      payload: packLoadingWorkflow({
        ...message.payload,
        strategy: message.strategy,
        singleCartonLimit: message.strategy === "maximum" && message.payload.mode === "single"
          ? undefined
          : message.payload.singleCartonLimit,
      }),
    };
    self.postMessage(response);
  } catch (error) {
    const response: WorkerResponse = {
      type: "error",
      requestId: message.requestId,
      strategy: message.strategy,
      message: error instanceof Error ? error.message : "计算失败，请检查输入。",
    };
    self.postMessage(response);
  }
};

export {};
