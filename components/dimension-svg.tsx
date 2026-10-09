import { DIMENSION_LINE_COLOR, DIMENSION_TEXT_COLOR, type DimensionAnnotation } from "../lib/packing/scene-dimensions";

/** The SVG fallback uses exactly the same measurements and layout as the WebGL overlay. */
export function DimensionSvg({dimensions,fontSize}:{dimensions:DimensionAnnotation[];fontSize:number}) {
  return <g className="dimension-annotations" data-dimension-count={dimensions.length}>
    {dimensions.map(d=><g key={d.axis} data-dimension-axis={d.axis}>
      <path d={d.segments.map(([a,b])=>`M ${a.x} ${a.y} L ${b.x} ${b.y}`).join(" ")} fill="none" stroke={DIMENSION_LINE_COLOR} strokeWidth={1.4} strokeLinecap="round"/>
      <text x={d.label.x+d.label.width/2} y={d.label.y+d.label.height/2} textAnchor="middle" dominantBaseline="central" fontFamily="Arial, sans-serif" fontSize={fontSize} fontWeight={600} fill={DIMENSION_TEXT_COLOR} stroke="#f7fbfb" strokeWidth={3} paintOrder="stroke">{d.text}</text>
    </g>)}
  </g>;
}
