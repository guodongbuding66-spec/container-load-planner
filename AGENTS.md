<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## CargoFit workbench

- Read DESIGN.md before UI edits. Keep marketing pages separate from the sequential planner.
- Reuse ExcelDataGrid, StatusBadge, UnitInput and SectionCard for data, statuses, measured inputs and grouped controls.
- During visual refactors, preserve solver constraints, saved data schemas and bearing calculations. Bug fixes to those areas need relevant regression cases.
- Keep every packaging recipe scoped to its product or complete kit. All enabled specifications participate in the calculation; switching a preview only changes inspection.
- Keep unverified ratings distinct from zero, and inapplicable tasks distinct from passed tasks.
- Verify changed screens in Chinese and English and at narrow and desktop widths. Report observed limits instead of claiming unperformed device checks.
