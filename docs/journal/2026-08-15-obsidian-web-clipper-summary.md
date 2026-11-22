# 决策摘要：2026-08-15 Obsidian Web Clipper 批处理

## 当前状态

- 已处理 2026-08-15 10:00-23:59（Asia/Shanghai）FileHelper 扫描结果中的 20 条“已收集链接”。
- 3 个“已跳过卡片”未处理，原因是扫描结果标记为视频卡片。
- 20 条文章最终都已写入 PlayWithExperiences vault，并被 Auto Mover 移动到 `Clippings` 根目录。

## 决策与理由

- 按既有规则只处理“已收集链接”，不处理“已跳过卡片”。
- 按用户偏好使用并发 `10`；失败项遵循 skill 的降并发重试策略。
- 以 source URL 在 vault 中的最终 Markdown 文件为落库判断依据，因为 Auto Mover 会在剪藏后移动文件。

## 改动与验证

- 输入文件：`obsidian-web-clipper-ingest/local/inputs/2026-08-15-filehelper-links.txt`，共 20 条 URL。
- 预检通过：`node ./scripts/setup.js`。
- 重建 Playwright 缓存：`npx playwright install chromium`，恢复 `chromium-1208` 及对应 headless shell。
- 批处理命令：
  `OBSIDIAN_CLIPPER_MAX_CONCURRENCY=10 node ./scripts/clip-links.js --input local/inputs/2026-08-15-filehelper-links.txt`
- 运行 manifest：`obsidian-web-clipper-ingest/local/runs/2026-08-15T05-45-40-968Z/manifest.json`。
- 结果：最终 `Success: 20 Failed: 0 Dry-run: 0`；首轮并发 10 成功 19/20，1 条在并发 2 重试后成功。
- 测试：`npm test`，14/14 通过。
- 最终 vault 核验：20/20 个 source URL 均匹配到 Markdown 文件；文件最终位于 `/Users/haodong/Documents/GitHub/PKM/PlayWithExperiences/Clippings/`。

## 事故教训

- 之前清理缓存后，项目依赖需要的 `chromium-1208` 不存在，导致 Playwright 无法启动；按依赖版本重新安装后恢复。
- 系统 Chrome 启动方式无法注册临时扩展，最终继续使用 skill 要求的隔离 Playwright Chromium。
- Auto Mover 会让 `waitForImportedNote` 先看到移动前路径；本次第一条记录的 manifest 路径是 `Clippings/WeChat/2026`，最终文件已移动到 `Clippings` 根目录，不能据瞬时路径判断失败。

## 未决问题

- 无。若希望文件保留在 `Clippings/WeChat/YYYY`，需要调整 Auto Mover 规则，而不是修改本次剪藏结果。

## Next steps

- 后续批处理继续使用并发 `10`。
- 落库复核优先按 source URL 检查最终 vault 位置，以适配 Auto Mover。

证据记录：[`2026-08-15-obsidian-web-clipper-transcript.md`](2026-08-15-obsidian-web-clipper-transcript.md)
