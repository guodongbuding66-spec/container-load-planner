import type { CargoShape } from "../lib/packing/types";
/** Illustrations of the selected family; dimensions are edited separately. */
export function CargoShapePreview({shape}:{shape:CargoShape}) {
  return <svg viewBox="0 0 84 58" aria-hidden="true" className="cargo-shape-preview">
    {shape === "cylinder" ? <><path d="M15 15v27c0 12 54 12 54 0V15" fill="#78b7c0" stroke="#338391"/><ellipse cx="42" cy="15" rx="27" ry="9" fill="#b7dce1" stroke="#338391"/></>
    : shape === "wedge" ? <><path d="M14 44 14 12 50 44Z" fill="#78b7c0"/><path d="M14 12 36 5 72 37 50 44Z" fill="#b7dce1"/><path d="M14 44 50 44 72 37 36 37Z" fill="#338391"/></>
    : shape === "trapezoid" ? <><path d="M9 44 23 16 48 16 62 44Z" fill="#78b7c0"/><path d="M23 16 43 7 68 7 48 16Z" fill="#b7dce1"/><path d="M48 16 68 7 80 35 62 44Z" fill="#338391"/></>
    : <g fill={shape === "irregular" ? "none" : "#78b7c0"} stroke="#338391" strokeDasharray={shape === "irregular" ? "4 3" : undefined}><path d="M14 19 53 7 76 21 37 33Z" fill={shape === "irregular" ? "none" : "#b7dce1"}/><path d="M14 19 37 33 37 54 14 40Z"/><path d="M37 33 76 21 76 42 37 54Z" fill={shape === "irregular" ? "none" : "#338391"}/></g>}
  </svg>;
}
