import {describe,it,expect} from 'vitest';
import {compareFclVsLcl} from './trade-advisory';
const price={lclRatePerWm:85,lclFixedFees:450,fcl20gpAllIn:1850,fcl40gpAllIn:2600,fcl40hqAllIn:2750};
describe('revision 9 freight reference limits',()=>{
 it('does not recommend one 40HQ for a load larger than its reference volume',()=>expect(compareFclVsLcl(100,15000,price).recommended).toBe('LCL'));
 it('does not recommend one 40HQ above rated reference payload',()=>expect(compareFclVsLcl(40,40000,price).recommended).toBe('LCL'));
});
