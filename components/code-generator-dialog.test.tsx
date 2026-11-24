import {renderToStaticMarkup} from "react-dom/server";
import {expect,it} from "vitest";
import {CodeGeneratorDialog} from "./code-generator-dialog";
const initial={codeType:"qrcode" as const,value:"SHED-101",width:40,height:40,showText:false};
it("offers insertion for a new QR preset even though its initial configuration exists",()=>{
 const html=renderToStaticMarkup(<CodeGeneratorDialog initial={initial} variables={{sku:"SHED-101"}} onInsert={()=>undefined} onClose={()=>{}}/>);
 expect(html).toContain("插入唛头");expect(html).not.toContain("更新所选编码");
});
it("offers an update only when editing an existing layer",()=>{
 const html=renderToStaticMarkup(<CodeGeneratorDialog initial={initial} editing variables={{}} onInsert={()=>undefined} onClose={()=>{}}/>);
 expect(html).toContain("更新所选编码");expect(html).not.toContain("插入唛头");
});
