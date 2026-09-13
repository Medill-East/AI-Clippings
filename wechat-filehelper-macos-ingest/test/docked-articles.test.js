import { it } from 'node:test';
import assert from 'node:assert/strict';
import { createDockedArticleSession, loadDockedLayout } from '../scripts/lib/docked-articles.js';
const layout = { mode: 'docked_articles', windowWidth: 1470, windowHeight: 923, chatWidth: 735, tabCloseX: 905, tabCloseY: 27 };
const win = { name: 'Weixin', x: 100, y: 33, width: 1470, height: 923 };
const shot = text => ({width:1470,height:923,lines:[{text:'File Transfer',x:316,y:20,width:100,height:20},...(text?[{text,x:760,y:15,width:140,height:20}]:[])]});
it('defers closure across two extractions, then closes tabs at the end', async () => {
  const actions=[]; let count=0;
  const session=createDockedArticleSession(layout, {
    getWindow:()=>win, activate:()=>{}, click:(...p)=>actions.push(['click',...p]),
    key:(k)=>actions.push(['key',k]), sleep:()=>{}, capture:()=>{},
    ocr:async()=>[shot('second article'),shot('first article'),shot(null)][count++],
    extract:async (candidate, options)=>{
      assert.equal(options.keepViewerOpen,true);
      assert.equal(options.preparedViewerContext.window.x,100);
      return {status:'ok',url:`https://mp.weixin.qq.com/s/${candidate.title}`};
    },
  });
  await session.scanOptions.extractShareCardUrlFn({title:'one'},{});
  await session.scanOptions.extractShareCardUrlFn({title:'two'},{});
  assert.equal(actions.filter(a=>a[0]==='key').length,0);
  assert.equal((await session.finish()).status,'closed');
  assert.equal(actions.filter(a=>a[0]==='click'&&a[1]===1005&&a[2]===60).length,2);
  assert.equal(actions.filter(a=>a[0]==='key').length,0);
});
it('scrolls within the calibrated chat pane rather than the article',()=>{
  let point;
  const session=createDockedArticleSession(layout,{getWindow:()=>win,activate:()=>{},click:()=>{},sleep:()=>{},scroll:(x,y)=>{point={x,y}}});
  session.scanOptions.scrollPageFn();
  assert.ok(point.x>win.x+300 && point.x<win.x+735);
});
it('rejects resized windows before opening a candidate',async()=>{
  const session=createDockedArticleSession(layout,{getWindow:()=>({...win,width:1200}),extract:()=>assert.fail('must not click')});
  await assert.rejects(session.scanOptions.extractShareCardUrlFn({},{}),/docked_layout_changed/);
});
it('does not report a blank screenshot as successful cleanup',async()=>{
  const session=createDockedArticleSession(layout,{getWindow:()=>win,activate:()=>{},click:()=>{},extract:async()=>({}),capture:()=>{},ocr:async()=>({width:1470,height:923,lines:[]})});
  await session.scanOptions.extractShareCardUrlFn({},{});
  const result=await session.finish();
  assert.equal(result.status,'failed');assert.equal(result.reason,'cleanup_screenshot_unavailable');
});
it('stops closing when the tab does not change',async()=>{
  let closes=0;
  const session=createDockedArticleSession(layout,{getWindow:()=>win,extract:async()=>({}),activate:()=>{},click:(x)=>{if(x===1005)closes++},key:()=>assert.fail("must not close host window"),sleep:()=>{},capture:()=>{},ocr:async()=>shot('same article')});
  await session.scanOptions.extractShareCardUrlFn({},{});
  assert.equal((await session.finish()).reason,'article_tab_not_closed');assert.equal(closes,1);
});
it('distinguishes absent calibration from corrupt calibration',async()=>{
  assert.equal(await loadDockedLayout('/unused',{readFile:async()=>{throw Object.assign(new Error(),{code:'ENOENT'})}}),null);
  await assert.rejects(loadDockedLayout('/unused',{readFile:async()=>'{}'}),/Invalid/);
});
it('requires the first article to be open rather than treating an empty right pane as ready',async()=>{
  const session=createDockedArticleSession(layout,{getWindow:()=>win,capture:()=>{},ocr:async()=>shot(null)});
  assert.equal((await session.probe({})).ui_probe_status,'docked_article_not_open');
});
it('adapts image-to-article detection and reuses the opened viewer for the original reroute',async()=>{
  const candidate={title:'Claude Science 用不上，试试学术版 Codex',clickX:537,clickY:707};
  let calls=0;
  const session=createDockedArticleSession(layout,{
    getWindow:()=>win,activate:()=>{},click:()=>{},capture:()=>{},
    ocr:async()=>({width:1470,height:923,lines:[{text:candidate.title,x:760,y:100,width:500,height:30}]}),
    extractImage:async(item,options,deps)=>({status:await deps.detectEmbeddedArticleFn(item)?'type_hint':'failed'}),
    extract:async(item,options)=>{calls++;assert.equal(options.reuseOpenViewer,calls===1);assert.equal(options.allowBrowserFallback,undefined);return {status:'ok'}},
  });
  assert.equal((await session.scanOptions.extractImageContentFn(candidate,{})).status,'type_hint');
  await session.scanOptions.extractShareCardUrlFn(candidate,{});
  await session.scanOptions.extractShareCardUrlFn(candidate,{});
});
it('waits through an initial loading frame before returning the existing article type hint',async()=>{
  const item={title:'加州 Media Lab 首届MDes开放27fall申请',clickX:526,clickY:390};let frames=0;
  const session=createDockedArticleSession(layout,{getWindow:()=>win,capture:()=>{},sleep:()=>{},
    ocr:async()=>({width:1470,height:923,lines:++frames===1?[{text:'Loading',x:760,y:20,width:100,height:20}]:[{text:item.title,x:760,y:100,width:550,height:30}]}),
    extractImage:async(c,o,d)=>d.detectEmbeddedArticleFn(c),
  });
  assert.equal(await session.scanOptions.extractImageContentFn(item,{}),true);assert.equal(frames,2);
});
it('captures the actual standalone viewer rather than the chat behind it',async()=>{
  const photo={name:'Photos and Videos',x:322,y:56,width:825,height:876};let bounds;
  const session=createDockedArticleSession(layout,{getWindow:()=>win,getFrontWindow:()=>photo,activate:()=>{},click:()=>{},capture:r=>{bounds=r},
    extract:async(c,o,d)=>{d.captureFullScreenScreenshotFn('/tmp/unused');return {status:'failed'}},
  });
  await session.scanOptions.extractShareCardUrlFn({},{});assert.deepEqual(bounds,photo);
});
it('captures only the article pane for a docked article readiness check',async()=>{
  let bounds;
  const session=createDockedArticleSession(layout,{getWindow:()=>win,getFrontWindow:()=>win,activate:()=>{},click:()=>{},capture:r=>{bounds=r},
    extract:async(c,o,d)=>{d.captureFullScreenScreenshotFn('/tmp/unused');return {status:'ok'}},
  });
  await session.scanOptions.extractShareCardUrlFn({},{});assert.equal(bounds.x,835);assert.equal(bounds.width,735);
});
it('uses a visible tab close glyph when the tab strip has shifted',async()=>{
  const {findVisibleTabClosePoint}=await import('../scripts/lib/docked-articles.js');
  const point=findVisibleTabClosePoint([{text:'4 一种看起来没出息，…X',x:2389,y:30,width:320,height:28}],{width:2940,height:1846},win);
  assert.ok(point.x>1400);assert.ok(point.y>45&&point.y<65);
});
