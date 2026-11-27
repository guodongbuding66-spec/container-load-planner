import {createServer} from "node:http";
import {createReadStream, existsSync, statSync} from "node:fs";
import {resolve, extname, sep} from "node:path";
const root=resolve("out");
const types={".html":"text/html; charset=utf-8",".js":"text/javascript; charset=utf-8",".css":"text/css; charset=utf-8",".json":"application/json",".svg":"image/svg+xml",".png":"image/png",".woff2":"font/woff2",".webmanifest":"application/manifest+json",".wasm":"application/wasm"};
createServer((req,res)=>{
 const pathname=decodeURIComponent(new URL(req.url,"http://localhost").pathname);
 const target=resolve(root,"."+pathname);
 if(target!==root&&!target.startsWith(root+sep)){res.writeHead(403).end();return;}
 if(pathname.startsWith("/api/")){res.writeHead(501,{"Content-Type":"application/json"}).end('{"error":"STATIC_QA_NO_API"}');return;}
 const file=[target,target+".html",resolve(target,"index.html")].find(p=>existsSync(p)&&statSync(p).isFile());
 if(!file){res.writeHead(404).end("Not found");return;}
 res.writeHead(200,{"Content-Type":types[extname(file)]||"application/octet-stream"});createReadStream(file).pipe(res);
}).listen(4173,"127.0.0.1");
