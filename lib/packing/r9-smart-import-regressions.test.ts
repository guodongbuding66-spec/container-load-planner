import {describe,it,expect} from 'vitest';
import {parseCombinedDimensions,parseSmartCargoText} from './smart-import';
describe('revision 9 independent smart import regressions',()=>{
 for(const s of ['-60x40x35cm','60x-40x35cm','60x40x-35cm','bad60x40x35cm','60cmx400mmx350mm'])it(`rejects malformed or ambiguous dimensions ${s}`,()=>expect(parseCombinedDimensions(s)).toBeNull());
 it('does not mark a negative combined dimension as a valid order',()=>expect(parseSmartCargoText('SKU,Size,Weight,Qty\nA,-60x40x35cm,10,5').validCount).toBe(0));
 it('keeps malformed quotes from being silently imported',()=>expect(parseSmartCargoText('SKU,Name,Length,Width,Height,Weight,Qty\nA,AB"CD"EF,600,400,350,10,5').validCount).toBe(0));
 it('does not discard nonempty surplus data columns',()=>expect(parseSmartCargoText('SKU,Length,Width,Height,Weight,Qty\nA,600,400,350,10,5,99').validCount).toBe(0));
 it('reads quoted multiline names as one record',()=>{const r=parseSmartCargoText('SKU,Name,Length,Width,Height,Weight,Qty\nA,"Chair\nOutdoor",600,400,350,10,5');expect(r.validCount).toBe(1);expect(r.errorCount).toBe(0);expect(r.rows[0].name).toBe('Chair\nOutdoor');});
});
