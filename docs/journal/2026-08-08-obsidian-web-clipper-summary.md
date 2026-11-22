# 决策摘要：2026-08-08 Obsidian Web Clipper 批处理

## 当前状态

- 已处理 2026-08-08 10:00-23:59（Asia/Shanghai）FileHelper 扫描结果中的 18 条“已收集链接”。
- 目标工作流为 `/Users/haodong/Documents/AI/Codex/Clippings/obsidian-web-clipper-ingest`，目标 vault 为 PlayWithExperiences。

## 决策与理由

- 按历史规则只处理“已收集链接”，不处理“已跳过卡片”（本次为空）。
- 按用户偏好和历史流程使用并发 `10` 运行，遇到失败自动触发重试流程。
- 结果以 manifest 统计 + 复核 `note` 落库为准；若后续显示 `success` 且 `waitForImportedNote` 命中则认定有效。

## 改动与验证

- 新增输入文件：`obsidian-web-clipper-ingest/local/inputs/2026-08-08-filehelper-links.txt`（18 条去重 URL）。
- 预检通过：`node ./scripts/setup.js`。
- 批处理命令：
  `OBSIDIAN_CLIPPER_MAX_CONCURRENCY=10 node ./scripts/clip-links.js --input local/inputs/2026-08-08-filehelper-links.txt`
- 主任务 manifest：`obsidian-web-clipper-ingest/local/runs/2026-08-08T07-37-53-282Z/manifest.json`。
- 结果：`Success: 18 Failed: 0 Dry-run: 0`
- Pass 情况：首次并发10处理成功 17/18 + 1 条失败，第二次并发2重试该失败项后成功。
- 文件落库复核：
  - 命令端口径：`importedNote.filePath` 均存在。
  - 共 18 条中 `missing = 0`。
- `clipTarget.sourceUrl` 与输入 URL 对齐；未发现额外可疑失败项。

## 事故教训

- 偶发重试是常态中的例外场景；已按 built-in retry policy 按序恢复。
- `importedNote` 仅返回 `filePath`，不包含 `source` 字段，因此 source 对齐核验应以 `clipTarget.sourceUrl` 与输入 URL 一致性 + 成功落库为准。

## 未决问题

- 无。

## Next steps

- 维持既有流程：如出现 `failed`，优先查看失败截图和 pass 明细后按单条重试。

证据记录：[`2026-08-08-obsidian-web-clipper-transcript.md`](2026-08-08-obsidian-web-clipper-transcript.md)
