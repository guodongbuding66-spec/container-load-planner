/** Real Chromium regression smoke run; execute against an already served build. */
import {pathToFileURL} from 'node:url';
const {chromium}=await import(process.env.QA_PLAYWRIGHT_ENTRY ? pathToFileURL(process.env.QA_PLAYWRIGHT_ENTRY).href : 'playwright');
import {mkdir,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const base=(process.env.QA_BASE_URL??'http://127.0.0.1:4173').replace(/\/+$/,'');
const out=process.env.QA_OUTPUT_DIR??'outputs/browser-qa';
await mkdir(out,{recursive:true});
const results=[];const actions=[];const actionability=[];const browser=await chromium.launch({headless:true,args:['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const sizes=process.env.QA_LIVE_BASELINE==='1'?[[1440,900],[390,844]]:[[1920,1080],[1440,900],[1280,720],[768,1024],[390,844],[320,640]];
const live=process.env.QA_LIVE_BASELINE==='1';
for(const [width,height] of sizes){
 for(const lang of ['zh','en']){
  const context=await browser.newContext({viewport:{width,height},locale:lang==='zh'?'zh-CN':'en-US',acceptDownloads:true});
  await context.addInitScript(lang=>localStorage.setItem('cargo-fit-language',lang),lang);
  const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(String(e)));page.on('console',m=>{if(m.type()==='error')errors.push(m.text())});
  const id=`${width}x${height}-${lang}`;
  const snap=async(name)=>{await page.screenshot({path:`${out}/${id}-${name}.png`,fullPage:true,animations:'disabled'});const geometry=await page.evaluate(()=>({viewport:innerWidth,document:document.documentElement.scrollWidth,body:document.body.scrollWidth,lang:document.documentElement.lang,controls:Array.from(document.querySelectorAll('button,input,select,a[href],summary')).filter(el=>{const r=el.getBoundingClientRect();const modal=document.querySelector('[aria-modal="true"]');return r.width&&r.height&&getComputedStyle(el).visibility!=='hidden'&&!el.closest('[hidden],[inert],[aria-hidden="true"]')&&(!modal||modal.contains(el))}).map(el=>({text:el.getAttribute('aria-label')||el.innerText||el.getAttribute('title')||el.getAttribute('placeholder')||el.tagName,disabled:!!el.disabled,rect:el.getBoundingClientRect().toJSON(),centerOccluded:(()=>{const r=el.getBoundingClientRect(),x=r.left+r.width/2,y=r.top+r.height/2;if(x<0||x>=innerWidth||y<0||y>=innerHeight||el.disabled)return null;for(let p=el.parentElement;p&&p!==document.body;p=p.parentElement){const ps=getComputedStyle(p),pr=p.getBoundingClientRect();if((/auto|scroll|hidden|clip/.test(ps.overflowX)&&(x<pr.left||x>=pr.right))||(/auto|scroll|hidden|clip/.test(ps.overflowY)&&(y<pr.top||y>=pr.bottom)))return null;}const hit=document.elementFromPoint(x,y);return !!hit&&hit!==el&&!el.contains(hit)&&!hit.contains(el);})()}))}));results.push({id,name,geometry,overflow:geometry.document>width+2,languageMismatch:!geometry.lang.toLowerCase().startsWith(lang),errors:[...errors]});};
  // Trial checks exercise browser hit-testing without mutating a user's project or billing state.
  // The real semantic assertions below are a separate metric; disabled controls are never called passes.
  const auditButtons=async(state)=>{
    if(live||!((width===1440&&lang==='zh')||(width===320&&lang==='en')))return;
    const scroll=await page.evaluate(()=>({x:scrollX,y:scrollY}));const buttons=page.locator('button:visible, [role="button"]:visible, summary:visible');
    const count=await buttons.count();let failures=0;
    for(let n=0;n<count;n++){const l=buttons.nth(n);let name='';try{
      name=await l.evaluate(el=>el.getAttribute('aria-label')||el.getAttribute('title')||el.textContent?.trim()||'(unnamed)');
      if(!await l.isEnabled()){actionability.push({id,state,index:n,name,status:'disabled'});continue;}
      if(name==='(unnamed)'){actionability.push({id,state,index:n,name,status:'fail',error:'Missing accessible label'});failures++;continue;}
      await l.click({trial:true,timeout:2000});actionability.push({id,state,index:n,name,status:'actionable'});
    }catch(e){actionability.push({id,state,index:n,name,status:'fail',error:String(e)});if(failures++<4)await page.screenshot({path:`${out}/${id}-${state}-control-${n}-blocked.png`}).catch(()=>{});}}
    await page.evaluate(({x,y})=>scrollTo(x,y),scroll);
  };
  try{
   for(const route of (live?['/']:['/landing','/crew','/app','/'])){const res=await page.goto(base+route,{waitUntil:'domcontentloaded',timeout:45000});assert(res?.ok(),`HTTP ${res?.status()} ${route}`);await page.waitForFunction(expected=>document.documentElement.lang.toLowerCase().startsWith(expected),lang,{timeout:10000}).catch(()=>{});await snap(route==='/'?'home':route.slice(1));}
   const app=page.locator('main[data-workflow-step]');
   await app.waitFor({state:'visible',timeout:15000});
   // Explicitly select loose loading. Default pallet workflow has a mandatory preview gate.
   const loose=page.locator('.loading-workflow-options button').filter({hasText:/散箱直接装柜|Load loose cartons/});
   await loose.click({timeout:10000});
   await page.waitForFunction(()=>document.querySelectorAll('.loading-workflow-options button')[1]?.getAttribute('aria-pressed')==='true',null,{timeout:10000});
   await snap('loose-selected');await auditButtons('step-1');
   const stage=page.locator('.stage-action-bar');
   for(let step=1;step<=6;step++){
    await page.waitForFunction(step=>document.querySelector('main[data-workflow-step]')?.getAttribute('data-workflow-step')===String(step),step,{timeout:15000});
    const primary=stage.locator('button.primary').first();
    await primary.waitFor({state:'visible',timeout:10000});
    await primary.scrollIntoViewIfNeeded();await primary.hover();
    await page.screenshot({path:`${out}/${id}-step-${step}-hover.png`,animations:'disabled'});
    await primary.click({timeout:15000});
    await page.waitForFunction(next=>document.querySelector('main[data-workflow-step]')?.getAttribute('data-workflow-step')===String(next),step+1,{timeout:20000});
    await snap(`step-${step}-after`);await auditButtons('step-'+(step+1));
   }
   await page.locator('.validation-chip').waitFor({state:'visible',timeout:60000});
   await page.waitForFunction(()=>/布局校验通过|Layout.*valid|Validation.*pass|发现异常|No cargo|未装入/i.test(document.querySelector('.validation-chip')?.textContent??''),null,{timeout:90000});
   await snap('calculation');
   const status=await page.locator('.validation-chip').innerText();
   assert(/布局校验通过|Layout.*valid|Validation.*pass/i.test(status),status);
   const theme=page.locator('.topbar-theme-btn');if(await theme.isVisible()&&await theme.isEnabled()){await theme.scrollIntoViewIfNeeded();await theme.click();await page.waitForTimeout(250);await snap('theme-toggled');await theme.click();}
   const canvas=page.locator('.scene-shell canvas').first();if(await canvas.isVisible()){await canvas.scrollIntoViewIfNeeded();const rect=await canvas.boundingBox();if(rect){await page.mouse.move(rect.x+rect.width/2,rect.y+rect.height/2);await page.mouse.down();await page.mouse.move(rect.x+rect.width/2+40,rect.y+rect.height/2+20,{steps:10});await page.mouse.up();await page.waitForTimeout(300);await snap('scene-orbit');}}
   if(!live){
     // Run controls in a disposable browser context; verify state rather than just clicks.
     const act=async(name,fn)=>{try{await fn();actions.push({id,name,status:'pass'});}catch(e){actions.push({id,name,status:'fail',error:String(e)});await page.screenshot({path:`${out}/${id}-${name}-failure.png`,fullPage:true}).catch(()=>{});}};
     const press=async(loc,expected='true')=>{await loc.scrollIntoViewIfNeeded();await loc.click({timeout:10000});await assertPressed(loc,expected);};
     const assertPressed=async(loc,expected)=>{for(let i=0;i<20;i++){if(await loc.getAttribute('aria-pressed')===expected)return;await page.waitForTimeout(100);}assert.equal(await loc.getAttribute('aria-pressed'),expected);};
     await act('orthographic-switch',async()=>{const l=page.locator('.plan-view-switch button').nth(1);await press(l);await page.locator('.plan-view-diagrams').waitFor({state:'visible'});await snap('orthographic');await press(page.locator('.plan-view-switch button').first());});
     const presets=page.locator('.scene-toolbar-presets button');
     for(let n=0;n<await presets.count();n++){
       const l=presets.nth(n);if(!await l.isVisible()||!await l.isEnabled()){actions.push({id,name:'camera-'+n,status:'disabled'});continue;}
       await act('camera-'+n,async()=>{await press(l);await snap('camera-'+n);});
     }
     const projections=page.locator('.scene-toolbar-segment button[aria-pressed]');
     for(let n=0;n<await projections.count();n++){const l=projections.nth(n);if(!await l.isVisible()||!await l.isEnabled())continue;await act('projection-'+n,async()=>{await press(l);});}
     for(const label of [/^箱标$|^Carton labels$/,/^SKU 汇总$|^SKU summaries$/]){
       const l=page.locator('.scene-view-toolbar button').filter({hasText:label}).first();
       if(await l.count()&&await l.isVisible()&&await l.isEnabled())await act('toggle-'+(label.source.includes('SKU')?'sku':'labels'),async()=>{const before=await l.getAttribute('aria-pressed');await press(l,before==='true'?'false':'true');await press(l,before);});
     }
     await act('timeline-range',async()=>{const range=page.locator('.packing-timeline input[type=range]');await range.fill('0');assert.equal(await range.inputValue(),'0');const next=page.locator('.timeline-step-controls button').last();await next.click();assert.equal(await range.inputValue(),'1');await page.locator('.timeline-step-controls button').first().click();assert.equal(await range.inputValue(),'0');await page.locator('.timeline-all').click();assert.equal(await range.inputValue(),await range.getAttribute('max'));await snap('timeline-controls');});
     await act('timeline-speed',async()=>{const speed=page.locator('.timeline-step-controls select');for(const value of ['2','4','1']){await speed.selectOption(value);assert.equal(await speed.inputValue(),value);}});
     await act('sku-visibility',async()=>{const l=page.locator('.legend-row button').first();const was=await l.evaluate(el=>el.classList.contains('muted'));await l.click();assert.notEqual(await l.evaluate(el=>el.classList.contains('muted')),was);await l.click();assert.equal(await l.evaluate(el=>el.classList.contains('muted')),was);});
     await act('review-and-export-tabs',async()=>{const tabs=page.locator('.workbench-tabs').filter({has:page.getByRole('button',{name:/装载明细与复核|Breakdown & review/})});if(!await tabs.count())throw Error('result tablist not found');await tabs.getByRole('button',{name:/装载明细与复核|Breakdown & review/}).click();await page.locator('#plan-review').waitFor({state:'visible'});await snap('result-review');await auditButtons('result-review');await tabs.getByRole('button',{name:/清单与导出|Manifests & exports/}).click();await snap('result-exports');await auditButtons('result-exports');const csv=page.getByRole('button',{name:/导出坐标 CSV|Export.*CSV/i}).last();await csv.scrollIntoViewIfNeeded();const d=page.waitForEvent('download',{timeout:15000});await csv.click();const dl=await d;assert(/\.csv$/i.test(dl.suggestedFilename()));await dl.saveAs(`${out}/${id}-placements.csv`);});
     const fixture={v:1,c:'QA ONLY',L:2000,W:1200,H:1200,tot:2,wt:20,vol:0.12,slices:[{idx:1,xFrom:0,xTo:1200,items:[{sku:'QA-ONLY-A',qty:2,dx:500,dy:400,dz:300,col:'#0F766E'}]}]};
     const crewUrl=payload=>base+'/crew#plan='+Buffer.from(JSON.stringify(payload)).toString('base64url');
     await page.goto(crewUrl(fixture),{waitUntil:'domcontentloaded'});
     await page.getByText('QA-ONLY-A',{exact:true}).waitFor();
     await page.locator('input[type=checkbox]').first().check();
     await page.getByPlaceholder('MSCU1234567').fill('QA-CONT-1');
     await page.getByPlaceholder('SL882910').fill('QA-SEAL-1');
     await snap('crew-draft');await auditButtons('crew-draft');
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
await browser.close();await writeFile(`${out}/actionability.json`,JSON.stringify(actionability,null,2));await writeFile(`${out}/actions.json`,JSON.stringify(actions,null,2));await writeFile(`${out}/results.json`,JSON.stringify(results,null,2));
const failed=results.filter(r=>r.overflow||r.languageMismatch||r.error||r.reason||r.errors?.length||(!live&&r.geometry?.controls?.some(c=>c.centerOccluded===true)));const actionFailures=actions.filter(a=>a.status==='fail');console.log(JSON.stringify({snapshots:results.length,failed:failed.map(({id,name,overflow,error,reason,errors,geometry})=>({id,name,overflow,error,reason,errors,occluded:geometry?.controls?.filter(c=>c.centerOccluded).map(c=>c.text)})),actionSummary:{total:actions.length,passed:actions.filter(a=>a.status==='pass').length,disabled:actions.filter(a=>a.status==='disabled').length,failed:actionFailures}},null,2));const blocked=actionability.filter(a=>a.status==='fail');console.log(JSON.stringify({actionability:{total:actionability.length,actionable:actionability.filter(a=>a.status==='actionable').length,disabled:actionability.filter(a=>a.status==='disabled').length,blocked}},null,2));if(failed.length||actionFailures.length||blocked.length)process.exitCode=1;
