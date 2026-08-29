# obsidian-web-clipper-batch

## 1235 2026-08-29 批量剪藏预检

本轮读取附件 `/Users/haodong/.codex/attachments/e012068d-a420-4a68-8d0b-94a4e7b74e6f/pasted-text.txt`。其中的微信扫描结果包含 36 条唯一链接：28 条完整文章/网页 URL、8 条视频号 URL；另有 2 条截断外链待确认、3 条图片 OCR 项。按 Web Clipper skill，已将 28 条完整文章/网页 URL 精确写入 `obsidian-web-clipper-ingest/local/inputs/2026-08-29-filehelper-links.txt`，排除视频号和截断外链。

输入校验结果为 28 条唯一 URL、无视频号 URL。`node ./scripts/setup.js` 通过，Chrome、自动化 profile 和 Web Clipper `1.7.1_1` 可用。视频号由另一 session 处理，本轮不重试。

批量 Web Clipper 尚未启动。按当前治理规则，需先取得对外部网页访问与解释器调用的明确授权。计划使用并发 10；按 skill 首轮及失败重试两轮，理论上最多 84 次网页/解释器尝试。解释器的具体服务、模型、配额和现实费用无法从本地配置可靠确定，因此在确认前不调用。

原始对话：`dialogues/2026-0829.md`「1235 obsidian-web-clipper-batch-preflight」
