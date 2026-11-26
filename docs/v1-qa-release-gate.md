# CargoFit V1 release gate — 2026-11-26

Source: uploaded 4 Neon branch (`3875c68`), based on the exact remote main tree `7ffa336a2a571be00b5f122ca6da784b2cf40e60`.

## Independent results

- Original: 45 independent geometry, payload, quantity and integration cases: 38 pass, 7 fail.
- Local QA fixes: 44 pass, 1 fail. Nesting is an estimate only; the actual solver does not implement nested-body contact, fit or bearing. Do not release this feature as working or publish the branch to production before validation.
- 21 source/HTML assertions pass. These are not browser rendering tests.
- Actual 20GP standalone maximum/practical 113/116 cartons; the existing `packWithComparison` can adopt the practical plan as a legal lower bound, but the heuristic is not a guaranteed global optimum.
- `npm ci --offline` fails with ENOTCACHED in this sandbox. Full lint, typecheck, Vitest, Next export, visual browser and cloud API tests are not yet passed.
- Added `lib/packing/v1-qa-regressions.test.ts` to normal Vitest and `scripts/qa-browser.mjs` for a reproducible, read-only Chromium smoke suite. The latter is not exhaustive or a replacement for manual per-control tests; inspect the JSON inventory and screenshots.

## Browser verification when dependencies and build are available

1. `npm ci && npm run build:pages`.
2. `npm install --no-save --package-lock=false playwright` and `npx playwright install chromium` (CI Linux may need `--with-deps`).
3. Serve `out/` with a static server supporting clean URLs, such as `npx http-server out -p 4173` (for clean paths use extension fallback, or deploy to a Vercel preview). For local use make sure `/app`, `/crew`, `/landing` resolve to `.html` or their corresponding index file.
4. Set `QA_BASE_URL` to the preview address or local server; run `node scripts/qa-browser.mjs`. Archive `outputs/browser-qa/` including every PNG and results JSON. Validate individual control actions, focus, accessibility, animation and responsiveness on the actual production-equivalent build before merge.

## Remaining engineering gates

Nested units need explicit physical grouped geometry, rotation and bearing validation. Crew QR long URL failure, KV route integration, camera/photo persistence, PWA offline and enterprise cloud/billing require actual deployed tests. Check pinwheel arrangements and product library import, advanced shapes, fixed sets, full pallet/crate preparation and manual adjustment, all export formats, VGM, axle loads, gap-fill and special cargo with verified field data. Treat road payload/lashing/OOG recommendations as estimates requiring carrier/engineer confirmation.
