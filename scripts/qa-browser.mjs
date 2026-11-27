/** Real Chromium regression smoke run; execute against an already served build. */
import {chromium} from 'playwright';
import {mkdir,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const base=process.env.QA_BASE_URL??'http://127.0.0.1:4173';
const out=process.env.QA_OUTPUT_DIR??'outputs/browser-qa';
await mkdir(out,{recursive:true});
const results=[];const browser=await chromium.launch({headless:true,args:['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const sizes=[[1920,1080],[1440,900],[1280,720],[768,1024],[390,844],[320,640]];
for(const [width,height] of sizes){
 for(const lang of ['zh','en']){
  const context=await browser.newContext({viewport:{width,height},locale:lang==='zh'?'zh-CN':'en-US',acceptDownloads:true});
  await context.addInitScript(lang=>localStorage.setItem('cargo-fit-language',lang),lang);
  const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(String(e)));page.on('console',m=>{if(m.type()==='error')errors.push(m.text())});
  const id=`${width}x${height}-${lang}`;
  const snap=async(name)=>{await page.screenshot({path:`${out}/${id}-${name}.png`,fullPage:true,animations:'disabled'});const geometry=await page.evaluate(()=>({viewport:innerWidth,document:document.documentElement.scrollWidth,body:document.body.scrollWidth,controls:Array.from(document.querySelectorAll('button,input,select,a[href],summary')).filter(el=>{const r=el.getBoundingClientRect();return r.width&&r.height&&getComputedStyle(el).visibility!=='hidden'}).map(el=>({text:el.getAttribute('aria-label')||el.innerText||el.getAttribute('title')||el.getAttribute('placeholder')||el.tagName,disabled:!!el.disabled,rect:el.getBoundingClientRect().toJSON()}))}));results.push({id,name,geometry,overflow:geometry.document>width+2,errors:[...errors]});};
  try{
   for(const route of ['/landing','/crew','/app','/']){const res=await page.goto(base+route,{waitUntil:'networkidle',timeout:45000});assert(res?.ok(),`HTTP ${res?.status()} ${route}`);await snap(route==='/'?'home':route.slice(1));}
   const stage=page.locator('.stage-action-bar');
   for(let step=1;step<=6;step++){
    if(!await stage.isVisible())break;
    const primary=stage.locator('button.primary').first();if(!await primary.isEnabled()){results.push({id,name:`step-${step}-blocked`,reason:'primary action disabled'});break;}
    await primary.scrollIntoViewIfNeeded();await primary.hover();await page.screenshot({path:`${out}/${id}-step-${step}-hover.png`,animations:'disabled'});
    await primary.click({timeout:10000});await page.waitForTimeout(step===6?1500:350);await snap(`step-${step}-after`);
   }
   if(await page.locator('.validation-chip').isVisible()){await page.waitForFunction(()=>document.querySelector('.validation-chip')?.textContent?.match(/布局校验通过|Layout.*valid|Validation.*pass|发现异常|No cargo|未装入/i),{},{timeout:120000}).catch(()=>{});await snap('calculation');}
  }catch(error){results.push({id,name:'error',error:String(error),errors:[...errors]});await page.screenshot({path:`${out}/${id}-failure.png`,fullPage:true}).catch(()=>{});}finally{await context.close();}
 }
}
await browser.close();await writeFile(`${out}/results.json`,JSON.stringify(results,null,2));
const failed=results.filter(r=>r.overflow||r.error||r.reason||r.errors?.length);console.log(JSON.stringify({snapshots:results.length,failed:failed.map(({id,name,overflow,error,reason,errors})=>({id,name,overflow,error,reason,errors}))},null,2));if(failed.length)process.exitCode=1;
