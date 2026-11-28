---
version: alpha
name: CargoFit Workbench
description: Sequential cargo planning, packaging review and shipment handover.
colors:
  ink: "#0F172A"
  muted: "#64748B"
  line: "#E2E8F0"
  surface: "#FFFFFF"
  canvas: "#F4F6F8"
  teal: "#0F766E"
  teal-dark: "#115E59"
  teal-soft: "#E6F4F0"
---

## Overview

CargoFit is an operational workbench for cargo entry, pallet construction, loading review and delivery records. Keep the sequential task visible and give the current model or result precedence over explanations.

## Colors

Use the canvas for the page, surface for primary modules and teal for the current step or primary action. Use semantic status pills for passed, unverified, exceeded and inapplicable states; retain the accompanying text.

## Typography

Use the existing sans-serif stack for inputs, headings and data. Align numeric columns to the right and use tabular numerals. Keep units in column headers or integrated input suffixes.

## Layout

Align every step to the same fluid content width as the header and navigation; use internal column layouts to control readable form widths. Keep narrow-screen controls reachable and preserve document reading order when columns collapse. Use one primary module level; separate its internal sections with spacing and rules.

## Components

Use ExcelDataGrid for dense diagnostic records, with sticky headers, bounded scrolling, search and pagination. Group only records that have identical packaging, contents, relative cargo geometry and load diagnostics. Export every original row and preserve unknown numeric values as blanks.

Use StatusBadge to distinguish warning, failure, success and inapplicable states. Use UnitInput for measured values and SectionCard for related controls with a shared heading. Reuse existing numeric validation and native keyboard behavior.

## Do's and Don'ts

Keep packaging recipes scoped to their product or complete kit. A preview selection changes inspection, while all saved specifications remain available to calculation. Preserve separate draft, applied and calculated states.

Do not introduce marketing animations into the workbench, hide engineering warnings to make a summary pass, or change packing constraints during visual refactoring. Do not overlay table actions on editable values or replace missing ratings with zero.

Use app/tokens.css as the implementation source for semantic roles and control sizes. CompactConstraintTable renders SKU bounds with explicit status, separate from a completed plan review.
