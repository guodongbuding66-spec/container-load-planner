import { visibleDimensionSegments, DIMENSION_LINE_COLOR, DIMENSION_TEXT_COLOR, type DimensionAnnotation, type DimensionColors } from "../lib/packing/scene-dimensions";

/** The SVG fallback uses exactly the same measurements and layout as the WebGL overlay. */
export function DimensionSvg({dimensions,fontSize,lineColor=DIMENSION_LINE_COLOR,textColor=DIMENSION_TEXT_COLOR}:{dimensions:DimensionAnnotation[];fontSize:number}&DimensionColors) {
  return <g className="dimension-annotations" data-dimension-count={dimensions.length}>
    <path d={visibleDimensionSegments(dimensions).map(([a,b])=>`M ${a.x} ${a.y} L ${b.x} ${b.y}`).join(" ")} fill="none" stroke={lineColor} strokeWidth={1.4} strokeLinecap="round"/>
    {dimensions.map(d=><g key={d.axis} data-dimension-axis={d.axis}>
      {[{text:d.text,label:d.label,font:fontSize},...d.ticks.map(t=>({...t,font:Math.max(10,Math.round(fontSize*.65))}))].map((t,i)=><text key={i} data-ruler-tick={i>0?"true":undefined} x={t.label.x+t.label.width/2} y={t.label.y+t.label.height/2} textAnchor="middle" dominantBaseline="central" fontFamily="Arial, sans-serif" fontSize={t.font} fontWeight={600} fill={textColor} stroke="#f7fbfb" strokeWidth={3} paintOrder="stroke">{t.text}</text>)}
    </g>)}
  </g>;
}
