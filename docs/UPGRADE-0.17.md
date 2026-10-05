# CargoFit 0.17 upgrade and verification

## Functional scope
- Transport library: 11 container presets, 9 truck spaces, 14 pallet/ULD envelopes; category tabs, search and locally saved custom spaces. Open-top dimensions are editable planning envelopes, not transport permits. Pallet platform height is outside usable cargo height.
- Cargo settings: six cargo types, six explicit orientation choices, color, dimensions, weight, quantity and layer limits. A cargo pallet base is already included in its outer height.
- Loading rules: depth/layer layouts, smart/deep search, size ordering that preserves required cargo and priority, and per-product support-area overrides. Overrides participate in solving and independent validation. Unknown packaging strength is not inferred from geometric support.
- Dedicated 3D viewer: plan selection, remaining volume/payload, SKU visibility, labels, pallet bases, seven camera views, rulers, image capture, fullscreen, presentation and integer-step playback.
- Excel template and XLSX import through a dedicated worker. Strict ZIP expansion bounds, formula rejection and atomic imports; CSV remains supported.
- Downloadable PDF: summary, three projections, SKU manifests, all placement coordinates and warnings. UTF-8/Chinese rendered through the browser's available fonts.
- Tutorial, FAQ, industry/challenge case filters, services/contact and enterprise integration guidance. Case provenance distinguishes published manifests from synthetic examples. Published totals are recomputed from line items; they are not historical calibration records.
- New panels and frequently used main labels support persisted Chinese/English selection. Some legacy detailed messages remain Chinese.

## Commercial/integration limits
The services page provides monthly/yearly inquiry choices and comparison; paid billing, subscriptions and quota enforcement are not enabled. Enterprise guidance uses the existing authenticated OS bridge and downloadable data contract; it does not create a public server API. These require explicit account/billing/backend configuration.

## Verification
- 223 unit tests, including orientation whitelist validation, support thresholds, open-load access, complete kit rollback, backup restoration, Excel parsing and PDF byte offsets.
- 21 source/structure regression checks; lint and TypeScript checks.
- Real Chromium: transport/cargo/rules dialogs, seven camera actions, playback, PNG and PDF downloads, tutorial at 320/768/1024/1440 px, English persistence; no page errors in completed viewer smoke test.
- Real Chromium downloaded the XLSX template and imported it through the worker; two kit rows and automatic single-product mode were retained.
- Downloaded PDF opened and first page visually inspected. Desktop viewer and mobile tutorial screenshots visually inspected.

## Input behavior
Cargo/rule dialogs stage edits until Save. Main table preserves the existing staged dimension-entry behavior; import revision checks prevent delayed files overwriting newer input.
