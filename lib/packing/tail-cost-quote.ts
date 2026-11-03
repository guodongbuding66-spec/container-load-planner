import {parseFleetPricing,type FleetPricing} from "./fleet-costs";
import type {PackingRequest} from "./types";
export type TailCostQuote={freight:number;pricing:FleetPricing};
export function parseTailCostQuote(value:unknown,request:PackingRequest):TailCostQuote{
 if(!value||typeof value!=="object"||Array.isArray(value))throw Error("费用报价无效 / Invalid tail pricing");
 const quote=value as TailCostQuote;
 if(typeof quote.freight!=="number"||!Number.isFinite(quote.freight)||quote.freight<0||quote.freight>1e9)throw Error("Invalid freight quote");
 const pricing=parseFleetPricing(quote.pricing,request);if(!pricing)throw Error("Missing tail pricing");
 return {freight:quote.freight,pricing};
}
