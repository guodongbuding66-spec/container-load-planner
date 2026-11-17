import { DEFAULT_PACKAGING, type PackagingSpec } from "./packaging";
import type { FloorPalletConfig, PalletBuildOptions } from "./types";

type BasePreset = {
  id: string;
  label: [string, string];
  base: PackagingSpec["base"];
  bottomDeck?: PackagingSpec["bottomDeck"];
  topDeck?: PackagingSpec["topDeck"];
  deckBoards: number;
  runners: number;
};

export const BASE_PRESETS: BasePreset[] = [
  {id:"nine-block",label:["九墩式 · 有底板","Nine-block · bottom boards"],base:"block",deckBoards:5,runners:3},
  {id:"block-open",label:["九墩式 · 无底板","Nine-block · open bottom"],base:"block",bottomDeck:"none",deckBoards:5,runners:3},
  {id:"stringer",label:["川字底板 · 三纵梁","Three-runner stringer base"],base:"stringer",deckBoards:7,runners:3},
  {id:"stringer-open",label:["三纵梁 · 无底板","Three stringers · open bottom"],base:"stringer",bottomDeck:"none",deckBoards:7,runners:3},
  {id:"block-grid",label:["田字底板 · 九墩","Grid bottom · nine blocks"],base:"block",bottomDeck:"grid",deckBoards:5,runners:3},
  {id:"nine-foot-deck",label:["九脚式 · 整面顶板","Nine feet · full deck"],base:"block",bottomDeck:"none",topDeck:"solid",deckBoards:5,runners:3},
  {id:"solid",label:["实心底板","Solid platform"],base:"solid",deckBoards:5,runners:3},
  {id:"corner-feet",label:["四角脚 · 整面底板","Four corner feet · full deck"],base:"corner-feet",deckBoards:5,runners:3},
];

type EnclosurePreset = {
  id: string;
  label: [string, string];
  description: [string, string];
  enclosure: PackagingSpec["enclosure"];
  lid: boolean;
  railCount?: number;
  panelSegments?: number;
};

export const ENCLOSURE_PRESETS: EnclosurePreset[] = [
  {id:"open",label:["开放托盘","Open pallet"],description:["保留底座，四周开放","Base with open sides"],enclosure:"none",lid:false},
  {id:"panel",label:["封板木箱","Closed crate"],description:["四面板材，可独立设置盖板厚度","Solid walls with adjustable lid thickness"],enclosure:"panel",lid:true},
  {id:"collar",label:["双层围板箱","Two-tier collar crate"],description:["两层围板，可设置单层高度","Two collars with adjustable tier height"],enclosure:"panel",lid:false,panelSegments:2},
  {id:"slatted",label:["五道条板木箱","Five-rail slatted crate"],description:["四角立柱与均布条板","Corner posts with evenly spaced rails"],enclosure:"slatted",lid:true,railCount:5},
  {id:"frame",label:["双横档框架","Two-rail frame"],description:["四角立柱与上下围框，顶部开放","Corner posts and top and bottom rails"],enclosure:"frame",lid:false,railCount:2},
  {id:"frame-three",label:["三横档框架","Three-rail frame"],description:["增加一道中部横档","Adds a middle rail"],enclosure:"frame",lid:false,railCount:3},
];

export function withBasePreset(config: FloorPalletConfig, preset: BasePreset): FloorPalletConfig {
  const {base,bottomDeck,topDeck,deckBoards,runners}=preset;
  return {...config,packaging:{...(config.packaging??DEFAULT_PACKAGING),base,bottomDeck,topDeck,deckBoards,runners,
    assembledBase:base==="block"||base==="stringer"?true:undefined,measurements:undefined}};
}

export function withEnclosurePreset(config: FloorPalletConfig, preset: EnclosurePreset): FloorPalletConfig {
  const {enclosure,lid,railCount,panelSegments}=preset;
  const spec=config.packaging??DEFAULT_PACKAGING;
  return {...config,maxCargoHeight:enclosure==="none"?config.maxCargoHeight:config.maxCargoHeight||1000,
    packaging:{...spec,enclosure,lid,railCount,panelSegments,railHeight:undefined}};
}

export const PALLET_ONLY_DEFAULT_HEIGHT = 1500;

/** Populate the independent pallet-only draft without imposing its limit on vehicle loading. */
export function palletOnlyDefaults(build: PalletBuildOptions): PalletBuildOptions {
  const withHeight=(config: FloorPalletConfig): FloorPalletConfig => config.maxCargoHeight?config:{...config,maxCargoHeight:PALLET_ONLY_DEFAULT_HEIGHT};
  return {...build,config:withHeight(build.config),...(build.additionalSpecs&&{additionalSpecs:build.additionalSpecs.map(spec=>({...spec,config:withHeight(spec.config)}))})};
}
