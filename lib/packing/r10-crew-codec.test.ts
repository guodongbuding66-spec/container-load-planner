import {describe,it,expect} from "vitest";
import {buildCrewSlicePayload,encodeCrewPayload,encodeCompactCrewPayload,decodeCrewPayload,compactCrewPayloadForQr} from "./crew-payload";
import {pack} from "./engine";
import {CONTAINER_PRESETS,SAMPLE_PRODUCTS} from "./presets";
describe("Lossless scannable crew links",()=>{
 const payload=buildCrewSlicePayload(pack({container:CONTAINER_PRESETS[2],products:SAMPLE_PRODUCTS,mode:"mixed",strategy:"maximum",clearance:10}));
 it("compresses without merging rows or dropping any SKU",()=>{
  const token=encodeCompactCrewPayload(payload);expect(token.length).toBeLessThan(encodeCrewPayload(payload).length*.6);
  expect(decodeCrewPayload(token)).toEqual(payload);expect(decodeCrewPayload(encodeCrewPayload(payload))).toEqual(payload);
  expect(compactCrewPayloadForQr(payload,42).fitsQr).toBe(true);
 });
 it("rejects truncated or malicious compressed tokens",()=>{
  expect(decodeCrewPayload("z1_not-valid")).toBeNull();expect(decodeCrewPayload(encodeCompactCrewPayload(payload).slice(0,20))).toBeNull();
 });
});
