# 决策摘要：2026-08-01 Obsidian Web Clipper 批处理

## 当前状态

- 已处理 2026-08-01 10:00-23:59（Asia/Shanghai）微信文件传输助手扫描中的 26 条“已收集链接”。
- 3 条 `video_channel` 卡片按批量规则忽略。
- 目标工作流为 `/Users/haodong/Documents/AI/Codex/Clippings/obsidian-web-clipper-ingest`，目标 vault 为 PlayWithExperiences。

## 决策与理由

- 仅解析“已收集链接”，不处理“已跳过卡片”，并按历史规则并发 10 运行。
- 因一次性出现 `Clipper error: This page cannot be clipped.`，按 skill 要求对该条进行单条重跑并按 `source:` 复核。
- 以 manifest 的 `clipTarget.sourceUrl` 与 vault note 的 `source:` 做最终一致性判据。

## 改动与验证

- 新增输入文件：`obsidian-web-clipper-ingest/local/inputs/2026-08-01-filehelper-links.txt`（26 条去重 URL）。
- 预检通过：`node ./scripts/setup.js`。
- 批处理命令（主任务）：
  `OBSIDIAN_CLIPPER_MAX_CONCURRENCY=10 node ./scripts/clip-links.js --input local/inputs/2026-08-01-filehelper-links.txt`
- 主任务 manifest：`obsidian-web-clipper-ingest/local/runs/2026-08-01T02-47-44-536Z/manifest.json`（成功 25，失败 1）。
- 重试命令（疑似失败 URL）：
  `OBSIDIAN_CLIPPER_MAX_CONCURRENCY=1 node ./scripts/clip-links.js "https://mp.weixin.qq.com/s/Pt_vpsZ_noq2GvtYAo6q_Q"`
- 重试 manifest：`obsidian-web-clipper-ingest/local/runs/2026-08-01T02-52-46-745Z/manifest.json`（成功 1）。
- 最终总计 26/26 成功落库，均通过 `clipTarget.sourceUrl` 与 note `source:` 对齐。

## 事故教训

- 偶发一次页面无法一次通过剪藏，重试后恢复，不影响全局。
- 建议保留一次性重跑策略，不在首轮失败时立即将任务判定为失败。

## 未决问题

- 无。

## Next steps

- 若下次扫描仍出现可疑 `failed`，优先对可疑 URL 单条重试；若重试仍失败，保留截图与链接以便人工复核后置处理。

证据记录：[`2026-08-01-obsidian-web-clipper-transcript.md`](2026-08-01-obsidian-web-clipper-transcript.md)
