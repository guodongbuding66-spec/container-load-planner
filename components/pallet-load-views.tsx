import { packagingInterior } from "../lib/packing/packaging";
import type { PalletRecipePreview } from "../lib/packing/pallet-recipe";
import { tr } from "./language";

export function PalletLoadViews({config,placements,height}:Pick<PalletRecipePreview,"config"|"placements"|"height">) {
  const {inset, lid} = packagingInterior(config);
  const base = "#c8ad82";
  const stroke = {stroke:"var(--panel, #fff)", strokeWidth:1, vectorEffect:"non-scaling-stroke" as const};
  const ground = Math.min(...placements.map(b => b.z));
  return <div className="pallet-recipe-views">
    <figure>
      <svg viewBox={`0 0 ${config.length} ${config.width}`} role="img" aria-label={tr("底层俯视","Bottom-layer plan")}>
        <rect width={config.length} height={config.width} fill={base}/>
        {placements.filter(b => Math.abs(b.z-ground) < .0001).map(b =>
          <rect key={b.id} x={b.x} y={b.y} width={b.dx} height={b.dy} fill={b.color} {...stroke}/>)}
      </svg>
      <figcaption>{tr("底层俯视","Bottom-layer plan")}</figcaption>
    </figure>
    <figure>
      <svg viewBox={`0 0 ${config.length} ${height}`} role="img" aria-label={tr("堆码侧视","Stack elevation")}>
        <rect y={height-config.height} width={config.length} height={config.height} fill={base}/>
        {inset > 0 && <><rect width={inset} height={height-config.height} fill={base}/><rect x={config.length-inset} width={inset} height={height-config.height} fill={base}/></>}
        {lid > 0 && <rect width={config.length} height={lid} fill={base}/>}
        {[...placements].sort((a,b) => b.y-a.y).map(b =>
          <rect key={b.id} x={b.x} y={height-config.height-b.z-b.dz} width={b.dx} height={b.dz} fill={b.color} {...stroke}/>)}
      </svg>
      <figcaption>{tr("堆码侧视","Stack elevation")}</figcaption>
    </figure>
  </div>;
}
