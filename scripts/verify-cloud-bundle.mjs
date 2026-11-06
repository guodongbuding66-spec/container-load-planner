import assert from "node:assert/strict";

// Exercise the Node bundle with no deployed database or email configuration.
delete process.env.CARGOFIT_CLOUD_MODE;
const { default: handler } = await import("../api/cargo.mjs");
const origin = "https://container-load-planner-gray.vercel.app";
for (const path of ["/api/cargo/status", "/api/cargo?route=status"]) {
  const response = await handler.fetch(new Request(origin + path));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { version: 1, enabled: false });
}
console.log("CargoFit bundled API passed its direct and rewritten route checks.");
