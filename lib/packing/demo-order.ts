import {SAMPLE_PRODUCTS} from "./presets";
import {DEFAULT_PALLET_BUILD} from "./loading-workflow";
import {DEFAULT_ACCESS} from "./maneuver";
import type {ProductInput,PalletBuildOptions} from "./types";
/** A modest floor-only demonstration, with documented computational limits. */
export const DEMO_PRODUCTS:ProductInput[]=SAMPLE_PRODUCTS.map((p,i)=>({...p,quantity:[30,66,48][i],rotationPolicy:"upright",orderLine:{orderReference:"DEMO",lineReference:String(i+1),batch:"",customer:"Demo",destination:"Demo",stop:1}}));
export const DEMO_ACCESS={...DEFAULT_ACCESS,maneuver:true,clearance:0,turn:false};
export function demoPalletBuild():PalletBuildOptions{return {...structuredClone(DEFAULT_PALLET_BUILD),config:{...structuredClone(DEFAULT_PALLET_BUILD.config),presetId:"demo-wide",name:"1200 × 2300",length:1200,width:2300,maxCargoHeight:1800}};}
export function isDemoOrder(products:readonly ProductInput[]){return products.length===DEMO_PRODUCTS.length&&products.every((p,i)=>{const d=DEMO_PRODUCTS[i];return p.id===d.id&&p.sku===d.sku&&p.length===d.length&&p.width===d.width&&p.height===d.height&&p.weight===d.weight&&p.quantity===d.quantity&&p.rotationPolicy===d.rotationPolicy&&p.orderLine?.orderReference==="DEMO";});}
