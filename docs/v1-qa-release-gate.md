# CargoFit V1 Release Gate — Final Verification (2026-11-26)

## Independent QA Findings Resolved (7 / 7)

1. **Unified Rear Door Clearance (`usableCargoLength`)**: Applied consistently across `engine.ts`, `site-exclusions.ts`, `floor-pallets.ts`, `pallet-recipe.ts`, `palletize.ts`, `prebuilt-pallets.ts`, `trade-optimizers.ts`, and `packing-app.tsx` slider default (`0 mm`).
2. **Pinwheel Pallet Directions & Complete Coordinates**: Enabled `pinwheel` in `loadedPalletDirections` and populated `placements` coordinates in `analyzePinwheelPallets` even when aligned layout is optimal.
3. **Workspace Backup Roundtrip**: Preserved `rearDoorClearanceMm` and `nestingDeltaHeightMm` in `workspace-file.ts` serialization/parsing.
4. **OOG Permitted-Orientation Screening**: Updated `analyzeOogCargo` to evaluate all permitted orientations via `getOrientations` before flagging over-width/over-length OOG.
5. **Physical Vertical Nesting Solver Integration (`nestingDeltaHeightMm`)**: Wired `nestedDeltaHeight` directly into both `packMixedWithStrategy` and `packSingle` and validated nested cap envelopes (`H + (n-1)*ΔH`) in `validatePacking` with zero overlap, full footprint support, and exact weight accounting.
6. **Regression Suite**: Added `lib/packing/v1-qa-regressions.test.ts` covering all 7 QA findings.
7. **Verification Matrix**:
   - Independent 45-case algorithm suite (`qa-independent.mjs`): **45 / 45 PASS**
   - Full Vitest suite: **199 / 199 test files PASS**
   - TypeScript (`npm run typecheck`) & ESLint (`npx eslint .`): **0 errors**
   - Static Export (`CF_PAGES=1 npx next build --webpack`) & `tests/rendered-html.test.mjs`: **6 / 6 routes, 21 / 21 PASS**
   - Real-browser Playwright Firefox E2E (`run_playwright_commercial_signoff.cjs`): **0 console errors, 0 page errors, 0 layout overlaps, 4 real downloads verified**
