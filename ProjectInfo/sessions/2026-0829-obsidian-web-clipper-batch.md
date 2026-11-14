# obsidian-web-clipper-batch

## 1235 2026-08-29 批量剪藏预检

本轮读取附件 `/Users/haodong/.codex/attachments/e012068d-a420-4a68-8d0b-94a4e7b74e6f/pasted-text.txt`。其中的微信扫描结果包含 36 条唯一链接：28 条完整文章/网页 URL、8 条视频号 URL；另有 2 条截断外链待确认、3 条图片 OCR 项。按 Web Clipper skill，已将 28 条完整文章/网页 URL 精确写入 `obsidian-web-clipper-ingest/local/inputs/2026-08-29-filehelper-links.txt`，排除视频号和截断外链。

输入校验结果为 28 条唯一 URL、无视频号 URL。`node ./scripts/setup.js` 通过，Chrome、自动化 profile 和 Web Clipper `1.7.1_1` 可用。视频号由另一 session 处理，本轮不重试。

批量 Web Clipper 尚未启动。按当前治理规则，需先取得对外部网页访问与解释器调用的明确授权。计划使用并发 10；按 skill 首轮及失败重试两轮，理论上最多 84 次网页/解释器尝试。解释器的具体服务、模型、配额和现实费用无法从本地配置可靠确定，因此在确认前不调用。

原始对话：`dialogues/2026-0829.md`「1235 obsidian-web-clipper-batch-preflight」

## 1247 2026-08-29 剪藏结果验收

在取得明确确认后，以 `OBSIDIAN_CLIPPER_MAX_CONCURRENCY=10 node ./scripts/clip-links.js --input local/inputs/2026-08-29-filehelper-links.txt` 启动批处理。运行 manifest 为 `/Users/haodong/Documents/AI/Codex/Clippings/obsidian-web-clipper-ingest/local/runs/2026-08-29T04-38-54-188Z/manifest.json`，包含首轮并发 10 和两轮失败重试（并发 2、1）。

最终结果为 27 条成功、1 条失败。对 vault 的 6221 个 Markdown 文件进行实质验收后，27 条成功 URL 均各自唯一匹配到非空笔记。由于 Auto Mover 当前关闭，27 条笔记均保留在 `Clippings/WeChat/2026`，这符合当前设置。

失败项为 `https://en.itu/`，三次尝试均未获得页面，最终错误为 `page.goto: net::ERR_CONNECTION_CLOSED`。该地址看起来不完整，但不能未经確認推断为同批次的 `https://en.itu.dk/...`；如需补齐，必须先提供真实完整 URL。视频号部分未在本轮重复处理。

原始对话：`dialogues/2026-0829.md`「1247 obsidian-web-clipper-batch-result」

## 1319 批量剪藏28条微信文章，27条成功

决策：無涘 ｜ 记录：codex（自动）｜ session 019d4493-d0e8-7a43-8d99-38b8ce64d857

使用obsidian web clipper skill处理28条微信文章/网页链接（排除8条视频号链接，由另一session负责）。预检确认配置正常后，以并发10启动批处理。最终结果：27条成功剪藏，逐条验收到非空Markdown笔记，位于Clippings/WeChat/2026目录（Auto Mover已关闭）；1条失败——https://en.itu/重试3次均为ERR_CONNECTION_CLOSED。manifest记录完整路径。

原始对话：dialogues/2026-0910.md「1319 obsidian-web-clipper-batch」

## 1938 微信升级后菜单定位修复

决策：無涘 ｜ 记录：codex（自动）｜ session 01a09a8f-210e-79d0-93d2-85ee0836e9c7

微信升级后公众号文章改为内嵌阅读栏打开，旧版代码依赖窗口数量判断和窗口宽度比例定位三点菜单，导致定位偏移。修复方案：新版使用固定边距（距右边缘约32像素），旧版独立窗口保留原有比例定位。同时调整策略为批次内保留阅读栏、全部处理完再统一关闭，避免窗口展开干扰左侧聊天区域卡片识别。80个测试通过，改动最小化，只改菜单定位一处。

原始对话：dialogues/2026-0913.md「1938 obsidian-web-clipper-batch」
