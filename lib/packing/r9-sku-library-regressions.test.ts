import {afterEach,describe,it,expect,vi} from 'vitest';
import {loadSkuLibrary,saveSkuLibrary,mergeProductsIntoLibrary,savedSkuToProduct} from './sku-library';
import {SAMPLE_PRODUCTS} from './presets';
afterEach(()=>vi.unstubAllGlobals());
describe('revision 9 product library data integrity',()=>{
 it('retains shape, nesting, orientation, stackability and kit rules when saving and adding an SKU',()=>{const p={...SAMPLE_PRODUCTS[0],cargoShape:'cylinder' as const,shapeAxis:'H' as const,stackable:false,rotationPolicy:'fixed' as const,maxTopLoadKg:0,setCode:'KIT',unitsPerSet:2,orderLine:undefined};const next=savedSkuToProduct(mergeProductsIntoLibrary([],[p])[0],0);expect(next.cargoShape).toBe('cylinder');expect(next.stackable).toBe(false);expect(next.rotationPolicy).toBe('fixed');expect(next.maxTopLoadKg).toBe(0);expect(next.setCode).toBe('KIT');expect(next.unitsPerSet).toBe(2);expect(next.id).not.toBe(p.id);});
 it('does not pass corrupt storage entries into the rendered library',()=>{vi.stubGlobal('window',{localStorage:{getItem:()=>JSON.stringify([null,{}, {sku:12}, {sku:'bad',length:-1}])}});expect(loadSkuLibrary()).toEqual([]);});
 it('reports storage quota failure instead of silently claiming persistence',()=>{vi.stubGlobal('window',{localStorage:{setItem:()=>{throw new Error('quota')}}});expect(saveSkuLibrary([])).toBe(false);});
});
