/** Real Chromium regression smoke run; execute against an already served build. */
import {pathToFileURL} from 'node:url';
const {chromium}=await import(process.env.QA_PLAYWRIGHT_ENTRY ? pathToFileURL(process.env.QA_PLAYWRIGHT_ENTRY).href : 'playwright');
import {mkdir,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const base=(process.env.QA_BASE_URL??'http://127.0.0.1:4173').replace(/\/+$/,'');
const out=process.env.QA_OUTPUT_DIR??'outputs/browser-qa';
await mkdir(out,{recursive:true});
const results=[];const browser=await chromium.launch({headless:true,args:['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const sizes=process.env.QA_LIVE_BASELINE==='1'?[[1440,900],[390,844]]:[[1920,1080],[1440,900],[1280,720],[768,1024],[390,844],[320,640]];
const live=process.env.QA_LIVE_BASELINE==='1';
for(const [width,height] of sizes){
 for(const lang of ['zh','en']){
  const context=await browser.newContext({viewport:{width,height},locale:lang==='zh'?'zh-CN':'en-US',acceptDownloads:true});
  await context.addInitScript(lang=>localStorage.setItem('cargo-fit-language',lang),lang);
  const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(String(e)));page.on('console',m=>{if(m.type()==='error')errors.push(m.text())});
  const id=`${width}x${height}-${lang}`;
  const snap=async(name)=>{await page.screenshot({path:`${out}/${id}-${name}.png`,fullPage:true,animations:'disabled'});const geometry=await page.evaluate(()=>({viewport:innerWidth,document:document.documentElement.scrollWidth,body:document.body.scrollWidth,lang:document.documentElement.lang,controls:Array.from(document.querySelectorAll('button,input,select,a[href],summary')).filter(el=>{const r=el.getBoundingClientRect();return r.width&&r.height&&getComputedStyle(el).visibility!=='hidden'}).map(el=>({text:el.getAttribute('aria-label')||el.innerText||el.getAttribute('title')||el.getAttribute('placeholder')||el.tagName,disabled:!!el.disabled,rect:el.getBoundingClientRect().toJSON(),centerOccluded:(()=>{const r=el.getBoundingClientRect(),x=r.left+r.width/2,y=r.top+r.height/2;if(x<0||x>=innerWidth||y<0||y>=innerHeight||el.disabled)return null;const hit=document.elementFromPoint(x,y);return !!hit&&hit!==el&&!el.contains(hit)&&!hit.contains(el);})()}))}));results.push({id,name,geometry,overflow:geometry.document>width+2,languageMismatch:!geometry.lang.toLowerCase().startsWith(lang),errors:[...errors]});};
  try{
   for(const route of (live?['/']:['/landing','/crew','/app','/'])){const res=await page.goto(base+route,{waitUntil:'domcontentloaded',timeout:45000});assert(res?.ok(),`HTTP ${res?.status()} ${route}`);await page.waitForFunction(expected=>document.documentElement.lang.toLowerCase().startsWith(expected),lang,{timeout:10000}).catch(()=>{});await snap(route==='/'?'home':route.slice(1));}
   const app=page.locator('main[data-workflow-step]');
   await app.waitFor({state:'visible',timeout:15000});
   // Explicitly select loose loading. Default pallet workflow has a mandatory preview gate.
   const loose=page.locator('.loading-workflow-options button').filter({hasText:/散箱直接装柜|Load loose cartons/});
   await loose.click({timeout:10000});
   await page.waitForFunction(()=>document.querySelectorAll('.loading-workflow-options button')[1]?.getAttribute('aria-pressed')==='true',null,{timeout:10000});
   await snap('loose-selected');
   const stage=page.locator('.stage-action-bar');
   for(let step=1;step<=6;step++){
    await page.waitForFunction(step=>document.querySelector('main[data-workflow-step]')?.getAttribute('data-workflow-step')===String(step),step,{timeout:15000});
    const primary=stage.locator('button.primary').first();
    await primary.waitFor({state:'visible',timeout:10000});
    await primary.scrollIntoViewIfNeeded();await primary.hover();
    await page.screenshot({path:`${out}/${id}-step-${step}-hover.png`,animations:'disabled'});
    await primary.click({timeout:15000});
    await page.waitForFunction(next=>document.querySelector('main[data-workflow-step]')?.getAttribute('data-workflow-step')===String(next),step+1,{timeout:20000});
    await snap(`step-${step}-after`);
   }
   await page.locator('.validation-chip').waitFor({state:'visible',timeout:60000});
   await page.waitForFunction(()=>/布局校验通过|Layout.*valid|Validation.*pass|发现异常|No cargo|未装入/i.test(document.querySelector('.validation-chip')?.textContent??''),null,{timeout:90000});
   await snap('calculation');
   const status=await page.locator('.validation-chip').innerText();
   assert(/布局校验通过|Layout.*valid|Validation.*pass/i.test(status),status);
   const theme=page.locator('.topbar-theme-btn');if(await theme.isVisible()&&await theme.isEnabled()){await theme.scrollIntoViewIfNeeded();await theme.click();await page.waitForTimeout(250);await snap('theme-toggled');await theme.click();}
   const canvas=page.locator('.scene-shell canvas').first();if(await canvas.isVisible()){await canvas.scrollIntoViewIfNeeded();const rect=await canvas.boundingBox();if(rect){await page.mouse.move(rect.x+rect.width/2,rect.y+rect.height/2);await page.mouse.down();await page.mouse.move(rect.x+rect.width/2+40,rect.y+rect.height/2+20,{steps:10});await page.mouse.up();await page.waitForTimeout(300);await snap('scene-orbit');}}
   if(!live){
     const fixture={v:1,c:'QA ONLY',L:2000,W:1200,H:1200,tot:2,wt:20,vol:0.12,slices:[{idx:1,xFrom:0,xTo:1200,items:[{sku:'QA-ONLY-A',qty:2,dx:500,dy:400,dz:300,col:'#0F766E'}]}]};
     const crewUrl=payload=>base+'/crew#plan='+Buffer.from(JSON.stringify(payload)).toString('base64url');
     await page.goto(crewUrl(fixture),{waitUntil:'domcontentloaded'});
     await page.getByText('QA-ONLY-A',{exact:true}).waitFor();
     await page.locator('input[type=checkbox]').first().check();
     await page.getByPlaceholder('MSCU1234567').fill('QA-CONT-1');
     await page.getByPlaceholder('SL882910').fill('QA-SEAL-1');
     await snap('crew-draft');
     await page.reload({waitUntil:'domcontentloaded'});
     await page.waitForFunction(()=>document.querySelector('input[type=checkbox]')?.checked===true,null,{timeout:10000});
     assert.equal(await page.getByPlaceholder('MSCU1234567').inputValue(),'QA-CONT-1');
     assert.equal(await page.getByPlaceholder('SL882910').inputValue(),'QA-SEAL-1');
     await snap('crew-reload');
     await page.goto(crewUrl({...fixture,c:'QA ONLY B'}),{waitUntil:'domcontentloaded'});
     await page.getByText('QA-ONLY-A',{exact:true}).waitFor();
     assert.equal(await page.getByPlaceholder('MSCU1234567').inputValue(),'');
     assert.equal(await page.locator('input[type=checkbox]').first().isChecked(),false);
     await snap('crew-isolation');
   }

  }catch(error){results.push({id,name:'error',error:String(error),errors:[...errors]});await page.screenshot({path:`${out}/${id}-failure.png`,fullPage:true}).catch(()=>{});}finally{await context.close();}
 }
}
await browser.close();await writeFile(`${out}/results.json`,JSON.stringify(results,null,2));
const failed=results.filter(r=>r.overflow||r.languageMismatch||r.error||r.reason||r.errors?.length);console.log(JSON.stringify({snapshots:results.length,failed:failed.map(({id,name,overflow,error,reason,errors})=>({id,name,overflow,error,reason,errors}))},null,2));if(failed.length)process.exitCode=1;
