import {describe,it,expect} from "vitest";
import {autoFixOrderInputs} from "./order-data-auditor";
import {SAMPLE_PRODUCTS} from "./presets";

describe("v3.2.3 independent order correction regressions",()=>{
 const large={...SAMPLE_PRODUCTS[0],id:"large",length:600,width:400,height:300};
 const small={...SAMPLE_PRODUCTS[1],id:"small",length:40,width:30,height:20,quantity:18};
 it("preserves a genuine small millimeter part beside a large carton",()=>{
  const rows=[large,small];const outcome=autoFixOrderInputs(rows);
  expect(outcome.fixedProducts).toEqual(rows);expect(outcome.fixCount).toBe(0);
 });
 it("converts only the explicitly confirmed row and preserves quantities and source data",()=>{
  const other={...small,id:"other"};const rows=[large,small,other];
  const outcome=autoFixOrderInputs(rows,[small.id]);
  expect(outcome.fixedProducts[1]).toMatchObject({length:400,width:300,height:200,quantity:18});
  expect(outcome.fixedProducts[2]).toEqual(other);expect(rows[1].length).toBe(40);
 });
 it("does not rescale or reorder shaped cargo as an ordinary box",()=>{
  const shaped={...small,length:30,width:45,cargoShape:"wedge" as const};
  expect(autoFixOrderInputs([large,shaped],[shaped.id]).fixedProducts[1]).toEqual(shaped);
 });
});
