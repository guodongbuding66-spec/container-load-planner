import { describe, expect, it } from "vitest";
import { compactCrewPayloadForQr, crewDraftKey, decodeCrewPayload, encodeCrewPayload, QR_SAFE_URL_LIMIT, type CrewSlicePayload } from "./crew-payload";
import { onRequestGet, onRequestOptions, onRequestPost } from "../../functions/api/crew-share";
const mega: CrewSlicePayload = { v:1,c:"40HQ High Cube Container",L:12032,W:2352,H:2698,tot:600,wt:18500,vol:64.2,slices:Array.from({length:10},(_,s)=>({idx:s+1,xFrom:s*1200,xTo:(s+1)*1200,items:Array.from({length:6},(_,i)=>({sku:"MEGA-SKU-"+s+"-"+i+"-EXPORT",qty:10,dx:500,dy:400,dz:350,col:"#0F766E"}))})) };
describe("Crew share safety", () => {
  it("preserves 600 cartons and 60 complete SKU identities", () => {
    const out=compactCrewPayloadForQr(mega,42);
    expect(out.token.length).toBeGreaterThan(QR_SAFE_URL_LIMIT);
    expect(out.fitsQr).toBe(false);
    expect(out.compacted).toBe(false);
    expect(decodeCrewPayload(out.token)).toEqual(mega);
  });
  it("rejects malformed tokens and isolates drafts", () => {
    expect(decodeCrewPayload(encodeCrewPayload({v:1,slices:[null]} as unknown as CrewSlicePayload))).toBeNull();
    expect(crewDraftKey("#plan="+encodeCrewPayload(mega),"")).not.toBe(crewDraftKey("#plan="+encodeCrewPayload({...mega,tot:601}),""));
  });
  it("validates KV POST, unbound fallback and full roundtrip", async () => {
    const store=new Map<string,string>();
    const kv={get:async(k:string)=>store.get(k)??null,put:async(k:string,v:string)=>{store.set(k,v);}};
    expect((await onRequestOptions()).status).toBe(204);
    const request=(body:string)=>new Request("https://example.com/api/crew-share",{method:"POST",body});
    expect((await onRequestPost({request:request("{}"),env:{}})).status).toBe(501);
    expect((await onRequestPost({request:request("bad"),env:{CREW_SHARE_KV:kv}})).status).toBe(400);
    expect((await onRequestPost({request:request('{"v":1,"slices":[null]}'),env:{CREW_SHARE_KV:kv}})).status).toBe(400);
    const result=await onRequestPost({request:request(JSON.stringify(mega)),env:{CREW_SHARE_KV:kv}});
    expect(result.status).toBe(201);
    const {id}=await result.json() as {id:string};
    const read=await onRequestGet({request:new Request("https://example.com/api/crew-share?id="+id),env:{CREW_SHARE_KV:kv}});
    expect(read.status).toBe(200);
    expect(await read.json()).toEqual(mega);
  });
});
