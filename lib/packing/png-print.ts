// Ported from BoxStudio src/pngPrintV70.js: retain real print-resolution metadata.
const signature=[137,80,78,71,13,10,26,10];
function crc32(bytes:Uint8Array){let crc=0xffffffff;for(const b of bytes){crc^=b;for(let i=0;i<8;i++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}return(crc^0xffffffff)>>>0;}
export function withPngDpi(input:Uint8Array,dpi=300){
 const bytes=new Uint8Array(input);if(!signature.every((b,i)=>bytes[i]===b)||!Number.isFinite(dpi)||dpi<72||dpi>1200)throw Error("Invalid PNG or print resolution");
 const ppm=Math.round(dpi/.0254),chunk=new Uint8Array(21),v=new DataView(chunk.buffer);v.setUint32(0,9);chunk.set([112,72,89,115],4);v.setUint32(8,ppm);v.setUint32(12,ppm);chunk[16]=1;v.setUint32(17,crc32(chunk.subarray(4,17)));
 const parts=[bytes.slice(0,8)];let offset=8,inserted=false,ended=false;
 while(offset+12<=bytes.length){const length=new DataView(bytes.buffer,bytes.byteOffset+offset,4).getUint32(0),end=offset+12+length;if(end>bytes.length)throw Error("Incomplete PNG");const type=String.fromCharCode(...bytes.subarray(offset+4,offset+8));if(type!=="pHYs")parts.push(bytes.slice(offset,end));if(type==="IHDR"){parts.push(chunk);inserted=true;}offset=end;if(type==="IEND"){ended=true;break;}}
 if(!inserted||!ended||offset!==bytes.length)throw Error("Incomplete PNG");
 const out=new Uint8Array(parts.reduce((n,p)=>n+p.length,0));let at=0;for(const p of parts){out.set(p,at);at+=p.length;}return out;
}
