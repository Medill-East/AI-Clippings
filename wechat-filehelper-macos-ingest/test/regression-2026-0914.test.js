import {it} from 'node:test';
import assert from 'node:assert/strict';
import {inferShareCardItemsFromOcr, captureVisibleUiPage, scanUiLinks} from '../scripts/lib/ui.js';
import {parseWeChatTimestamp} from '../scripts/lib/common.js';
const line=(text,x,y,width=300,height=28)=>({text,x,y,width,height});
const dims={imageWidth:1470,imageHeight:1846};
it('recovers single-line Gwen and Nicky titles with their separated publisher footers',()=>{
  const found=inferShareCardItemsFromOcr([
    line('Gwen | 在德国读游戏博士',845,292),line('0 游戏八分半',850,448,145,24),
    line('Nicky Case 行之，明也',845,1087),line('0 indienova',848,1242,137,24),
    line('*、 Send',1120,1790,160,30),
  ],dims);
  assert.deepEqual(found.map(x=>x.title),['Gwen | 在德国读游戏博士','Nicky Case 行之，明也']);
  assert.ok(found.every(x=>x.contentType!== 'image'));
});
it('uses the preceding chat time across a tall card, not a following message time',()=>{
  const found=inferShareCardItemsFromOcr([
    line('Yesterday 16:09',950,300,200,24),line('旧内容测试标题',845,900),line('0 测试来源',850,1030,150,24),
    line('Yesterday 19:27',950,1100,200,24),line('新内容测试标题',845,1300),line('0 测试来源',850,1430,150,24),
  ],dims);
  assert.deepEqual(found.map(x=>x.timestampText),['Yesterday 16:09','Yesterday 19:27']);
});
it('resolves 21:06 seen at 00:13 to the previous day, without changing explicit Today',()=>{
  const now=new Date('2026-09-14T00:13:00+08:00');
  assert.equal(parseWeChatTimestamp('21:06',now,{notAfterReference:true}).toISOString(),'2026-09-13T13:06:00.000Z');
  assert.equal(parseWeChatTimestamp('00:09',now,{notAfterReference:true}).toISOString(),'2026-09-13T16:09:00.000Z');
  assert.equal(parseWeChatTimestamp('今天 00:09',now,{notAfterReference:true}).toISOString(),'2026-09-13T16:09:00.000Z');
});
it('does not extract old cards when the start-boundary timestamp is separate from a card',async()=>{
  const ocr={width:1470,height:1846,lines:[line('File Transfer',620,30,200,30),
    line('比起始边界更早的卡片',845,300),line('0 测试来源',850,430,150,24),
    line('Yesterday 16:09',950,500,200,24),line('旧消息截图内容',845,900),line('0 测试来源',850,1030,150,24)]};
  const result=await scanUiLinks(new Date('2026-09-13T19:00:00+08:00'),new Date('2026-09-14T23:59:59+08:00'),1,false,{
    nowFn:()=>new Date('2026-09-14T00:13:00+08:00'),waitForUserReadyFn:async()=>{},navigateToFileHelperFn:async()=>{},
    probeUiEnvironmentFn:async()=>({ui_probe_status:'ready'}),
    captureVisibleUiPageFn:options=>captureVisibleUiPage({...options,prefetchedOcrResult:ocr,prefetchedWindow:{x:0,y:33,width:735,height:923}},
      {recognizeTextFromImageFn:async()=>ocr}),
    extractShareCardUrlFn:()=>assert.fail('old article must not be opened'),
    extractImageContentFn:()=>assert.fail('old image must not be opened'),
    scrollPageFn:()=>assert.fail('already passed start boundary'),
  });
  assert.equal(result.records.length,0);assert.equal(result.stats.termination_reason,'reached_before_since');
});
it('counts one URL when a card reappears with a different time association',async()=>{
  const ocr={width:1470,height:1846,lines:[line('File Transfer',620,30,200,30),
    line('21:06',990,280,90,24),line('同一链接的第一张卡片',845,330),line('0 测试来源',850,460,150,24),
    line('00:09',990,650,90,24),line('同一链接的再次转发',845,800),line('0 测试来源',850,940,150,24)]};
  const result=await scanUiLinks(new Date('2026-09-13T19:00:00+08:00'),new Date('2026-09-14T23:59:59+08:00'),1,false,{
    maxCandidates:2,nowFn:()=>new Date('2026-09-14T00:13:00+08:00'),waitForUserReadyFn:async()=>{},navigateToFileHelperFn:async()=>{},
    probeUiEnvironmentFn:async()=>({ui_probe_status:'ready'}),
    captureVisibleUiPageFn:options=>captureVisibleUiPage({...options,prefetchedOcrResult:ocr,prefetchedWindow:{x:0,y:33,width:735,height:923}},{recognizeTextFromImageFn:async()=>ocr}),
    extractShareCardUrlFn:async()=>({status:'ok',url:'https://mp.weixin.qq.com/s/same-url'}),
    scrollPageFn:()=>assert.fail('two candidates exhausted'),
  });
  assert.equal(result.records.length,1);assert.equal(result.stats.type_outcomes.article.deduplicated,1);
});
it('locates the actual close icon in the saved crowded tab strip', {skip:process.platform!=='darwin'},async()=>{
  const {fileURLToPath}=await import('node:url');
  const {detectArticleTabClose}=await import('../scripts/lib/tab-controls.js');
  const found=await detectArticleTabClose(fileURLToPath(new URL('./fixtures/docked-tabbar.png',import.meta.url)),{windowWidth:735,chatWidth:0});
  assert.ok(found);assert.ok(Math.abs(found.x-612)<3);assert.ok(Math.abs(found.y-56)<3);
});
it('defers a clipped previous time group until its preceding timestamp is visible',async()=>{
  const common=[line('File Transfer',620,30,200,30)];
  const pages=[
    {width:1470,height:1846,lines:[...common,line('旧消息截图内容',845,300),line('0 测试来源',850,430,150,24),line('Yesterday 19:27',950,600,200,24)]},
    {width:1470,height:1846,lines:[...common,line('Yesterday 16:09',950,142,200,24),line('旧消息截图内容',845,900),line('0 测试来源',850,1030,150,24)]},
  ];let index=0;
  const result=await scanUiLinks(new Date('2026-09-13T19:00:00+08:00'),new Date('2026-09-14T23:59:59+08:00'),2,false,{
    nowFn:()=>new Date('2026-09-14T00:13:00+08:00'),waitForUserReadyFn:async()=>{},navigateToFileHelperFn:async()=>{},
    probeUiEnvironmentFn:async()=>({ui_probe_status:'ready'}),
    captureVisibleUiPageFn:options=>captureVisibleUiPage({...options,prefetchedOcrResult:pages[index++],prefetchedWindow:{x:0,y:33,width:735,height:923}}),
    readVisibleClipboardSnapshotFn:()=>({rawText:'',blocks:[],stats:{skipped_by_rule:{}}}),
    extractShareCardUrlFn:()=>assert.fail('old card must be deferred, then excluded'),
    extractImageContentFn:()=>assert.fail('old image must be deferred, then excluded'),scrollPageFn:()=>{},
  });
  assert.equal(index,2);assert.equal(result.records.length,0);assert.equal(result.unresolvedRecords.length,0);
});
it('copies a docked video link after restoring hover lost during screenshot capture',async()=>{
 const {extractShareCardUrl}=await import('../scripts/lib/ui.js');
 const main={name:'Weixin',x:0,y:33,width:1470,height:923};
 const pane={...main,x:735,width:735};
 const context={window:main,screenRect:main,screenBounds:pane,mode:'docked_article',ocrResult:{width:1470,height:1846,lines:[line('视频号',30,30,100,25)]}};
 let hover=false,clipboard='',restored=0;
 const result=await extractShareCardUrl({title:'视频号',clickX:560,clickY:400},{keepViewerOpen:true,reuseOpenViewer:true},{
  getWeChatWindowsFn:()=>[main],getFrontWeChatWindowFn:()=>main,
  detectViewerContextFn:async()=>context,waitForViewerReadyFn:async()=>context,
  clearClipboardTextFn:()=>{clipboard='';hover=false},activateWeChatFn:()=>{},sleepMsFn:()=>{},
  moveMouseToPointFn:(x,y)=>{assert.ok(x>1300&&x<1320);hover=true;restored++},
  clickAtPointFn:(x,y)=>{if(Math.abs(x-1257)<2&&Math.abs(y-842)<2&&hover)clipboard='https://weixin.qq.com/sph/regression';},
  captureRectScreenshotFn:()=>assert.fail('use video surface capture'),
  captureVideoShareScreenshotFn:rect=>{assert.equal(rect.x,735);assert.equal(rect.width,735);hover=false},
  recognizeTextFromImageFn:async()=>({width:1470,height:1846,lines:[line('复制链接',984,1602,118,33)]}),
  readClipboardTextFn:()=>clipboard,closeViewerWindowFn:()=>assert.fail('keep docked video open'),
 });
 assert.equal(restored,1);assert.equal(result.status,'ok');assert.equal(result.url,'https://weixin.qq.com/sph/regression');
});
