# ProjectProgress

*更新于 2026-09-19 19:31 +0800 · 记录者 Codex*

## 现在在哪

- 2026-09-19 这批已确认链接处理完成：14 篇公众号文章和 12 个视频号分享短链；视频按内容去重后为 7 个唯一视频。
- 文章 14/14 已进入 Web Clipper，逐条核实请求 URL 与 `clipTarget.sourceUrl` 一致，笔记文件存在且含源链接。
- 视频 7/7 均已完成本地 ASR、摘要和 PKM 写入；逐条核实成功 manifest、笔记文件和对应源链接。重复短链没有重复生成摘要。
- 合并清单与纯链接文件已生成，位于视频采集仓库被 Git 忽略的 `local/exports/`，不会进入公开仓库。

## 已完成验证

- 文章 manifest：`obsidian-web-clipper-ingest/local/runs/2026-09-19T10-22-02-040Z/manifest.json`；14 个 source URL 和 14 个笔记目标均通过回读。
- 视频源 manifest：`wechat-filehelper-macos-ingest/local/video-channel/runs/2026-09-19T03-52-37-185Z/manifest.json`；12 个分享链接去重为 7 个视频。
- 7 个视频重处理 manifest 分别位于 `local/video-channel/runs/2026-09-19T10-27-10-900Z/`、`10-59-52-593Z/`、`11-03-26-071Z/`、`11-05-31-927Z/`、`11-07-44-196Z/`、`11-10-58-934Z/` 和 `11-14-38-295Z/`，均为 `complete` 且各写入 1 条。
- 清单文件：`wechat-filehelper-macos-ingest/local/exports/2026-0919-merged-wechat-links.md`；纯链接文件：同目录 `2026-0919-merged-wechat-links.txt`，共 21 个唯一源链接。
- 10:30 的一次中断运行曾留下 27/36 个已完成 ASR 分片；续跑复用这些结果，完成剩余分片并成功写入。同一 task 的最终状态为 `written`。其旧 run manifest 仍保留当时的 `running` 状态，不能代表现在仍在运行。

## 性能观察与限制

- 视频任务串行执行；每次只有一个 ASR 分片 worker。V2T 设置为 `auto`，本机 10 个逻辑 CPU 核对应 5 个 Sherpa 线程。观察到单 worker 瞬时约 97%–181% CPU，可能造成卡顿，但没有并行启动多个 ASR。
- 最终检查未发现仍运行的 ASR/视频处理进程。采样时 WindowServer 与 Codex 图形进程占用也较高，内存空闲约 64%、swap 为 0；这些是时间点快照，不能单独证明卡顿的唯一原因。
- 为降低前台影响，后续五条视频使用 nice 19 低调度优先级。临时视频与逐字稿按默认策略清理。

## 下一步

- 本轮已确认范围内无剩余项。未重新扫描微信，也未扩展处理输入清单之外的 unresolved 图片/卡片。

## 阻塞 / 待定

- 无。
