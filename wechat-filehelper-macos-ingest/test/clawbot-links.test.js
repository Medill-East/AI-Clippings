import { it } from 'node:test';
import assert from 'node:assert/strict';
import { collectClawbotLinks } from '../scripts/export-clawbot-links.js';
it('routes forwarded article and video links separately and deduplicates article tracking URLs', () => {
  const r = collectClawbotLinks([{ item_list: [
    {type:1,text_item:{text:'[链接] 标题 https://mp.weixin.qq.com/s/abc?tracking=1'}},
    {type:1,text_item:{text:'https://mp.weixin.qq.com/s/abc?tracking=2'}},
    {type:1,text_item:{text:'[视频号] 描述 https://weixin.qq.com/sph/abc'}},
  ]}]);
  assert.deepEqual(r.records.map(x=>x.url), ['https://mp.weixin.qq.com/s/abc']);
  assert.deepEqual(r.video_channels.map(x=>x.url), ['https://weixin.qq.com/sph/abc']);
});
it('does not mistake a merged-forward ZIP or unknown card for parsed links', () => {
  const r=collectClawbotLinks([{item_list:[{type:4,file_item:{file_name:'聊天记录.zip'}},{type:99,card:{url:'https://example.com'}}]}]);
  assert.equal(r.records.length,0);
  assert.equal(r.attachments[0].status,'not_expanded');
  assert.equal(r.unsupported_items[0].type,99);
});
