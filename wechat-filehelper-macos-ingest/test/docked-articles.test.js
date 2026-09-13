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
      assert.equal(options.preparedViewerContext.articleLeft,835);
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
