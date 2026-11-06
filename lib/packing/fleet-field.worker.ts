import { previewFieldReplacement } from "./fleet-field";
import type { FleetAllocationRestriction } from "./fleet";
import type { FleetSnapshot } from "./fleet-tail";

self.onmessage = (event: MessageEvent<{ value: FleetSnapshot; restriction: FleetAllocationRestriction }>) => {
  try {
    self.postMessage({ result: previewFieldReplacement(event.data.value, event.data.restriction) });
  } catch (error) {
    self.postMessage({ error: error instanceof Error ? error.message : String(error) });
  }
};
