#!/usr/bin/env node
// Offline export only. Never opens WeChat, fetches content, or invokes a model.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { canonicalizeUrl, extractUrlsFromText, classifySkipReason } from './lib/common.js';

export function collectClawbotLinks(messages) {
  const seen = new Set();
  const result = { records: [], video_channels: [], skipped: [], attachments: [], unsupported_items: [] };
  for (const message of messages) {
    for (const item of message.item_list ?? []) {
      if (item.type !== 1) {
        const detail = { message_id: message.message_id, type: item.type };
        if (item.type === 4) result.attachments.push({ ...detail, name: item.file_item?.file_name, status: 'not_expanded' });
        else result.unsupported_items.push(detail);
        continue;
      }
      const text = item.text_item?.text ?? '';
      for (const raw of extractUrlsFromText(text)) {
        const url = canonicalizeUrl(raw);
        if (seen.has(url)) continue;
        seen.add(url);
        const record = { url, source: 'clawbot', message_id: message.message_id,
          received_time_ms: message.create_time_ms, text };
        let parsed;
        try { parsed = new URL(url); }
        catch { result.skipped.push({ ...record, reason: 'invalid_url' }); continue; }
        if (parsed.hostname === 'weixin.qq.com' && parsed.pathname.startsWith('/sph/')) {
          result.video_channels.push(record);
        } else {
          const reason = classifySkipReason(url);
          if (reason) result.skipped.push({ ...record, reason });
          else result.records.push(record);
        }
      }
    }
  }
  return result;
}

async function main() {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../local/clawbot-probe');
  const files = (await fs.readdir(root)).filter(n => /^message-.*\.json$/.test(n)).sort();
  const messages = await Promise.all(files.map(async n => JSON.parse(await fs.readFile(path.join(root, n), 'utf8'))));
  const result = collectClawbotLinks(messages);
  await fs.writeFile(path.join(root, 'links.json'), JSON.stringify(result, null, 2)+'\n', { mode: 0o600 });
  for (const [name, rows] of [['article-links.txt', result.records], ['video-links.txt', result.video_channels]]) {
    await fs.writeFile(path.join(root, name), rows.map(r => r.url).join('\n') + (rows.length ? '\n' : ''), { mode: 0o600 });
  }
  console.log(JSON.stringify(Object.fromEntries(Object.entries(result).map(([k,v]) => [k,v.length]))));
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(e => { console.error(e.message); process.exitCode = 1; });
}
