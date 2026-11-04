import {parseFleetBackup,serializeFleetBackup} from "./fleet-file";
import type {FleetSnapshot} from "./fleet-tail";
import type {PackingRequest} from "./types";

/** A root input update remounts FleetPlanner; carry only an exact, validated request. */
export function fleetTailHandoff(value:FleetSnapshot|null|undefined,request:PackingRequest){
 if(!value)return null;
 try{return parseFleetBackup(serializeFleetBackup(value),request);}catch{return null;}
}
