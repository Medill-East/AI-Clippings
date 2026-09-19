# ProjectProgress

*更新于 2026-09-19 · 记录者 codex*

## 现在在哪

- 本轮已确认链接处理完成：14 篇公众号文章，以及 12 个视频号分享短链去重后的 7 个唯一视频。
- 文章 14/14 已剪藏；每条请求 URL 与剪藏目标一致，笔记存在且包含对应源链接。
- 视频 7/7 均完成本地 ASR、摘要与 PKM 写入；视频媒体和逐字稿按默认流程清理。
- 合并清单含 21 个唯一源链接，保存在视频采集仓库被 Git 忽略的 local/exports/。

## 已完成验证

- 文章 manifest：obsidian-web-clipper-ingest/local/runs/2026-09-19T10-22-02-040Z/manifest.json；14 个目标均通过回读。
- 视频源 manifest：wechat-filehelper-macos-ingest/local/video-channel/runs/2026-09-19T03-52-37-185Z/manifest.json；12 个分享短链对应 7 个唯一视频。
- 七个成功重处理 manifest 位于 wechat-filehelper-macos-ingest/local/video-channel/runs/ 下，时间分别为 10-27-10-900Z、10-59-52-593Z、11-03-26-071Z、11-05-31-927Z、11-07-44-196Z、11-10-58-934Z、11-14-38-295Z；均为 complete 且各写入 1 条。
- 合并清单：wechat-filehelper-macos-ingest/local/exports/2026-0919-merged-wechat-links.md；纯链接文件：同目录 2026-0919-merged-wechat-links.txt。
- 一次中断任务留下 27/36 个已完成分片；后续以同一 task ID 恢复并完成。10:30 的旧 manifest 仍显示 running，是历史记录状态，不代表有进程运行。

## 性能观察与限制

- 视频任务串行；每次只有一个 ASR 分片 worker。V2T auto 在本机 10 个逻辑 CPU 上解析为 5 个 Sherpa 线程。单 worker 曾出现约 97%–181% CPU，可能加重卡顿，但不是并行 ASR。
- 完成后未发现 ASR worker。采样时 WindowServer 与 Codex 图形进程占用较高；内存空闲约 64%、swap 为 0。这些时间点快照不足以单独判定卡顿根因。
- 为降低前台影响，后五个视频使用 nice 19。输入之外的 unresolved 卡片未扩展处理，也没有重新扫描微信。

## 下一步

- 本轮确认范围内无剩余项；后续按文章与视频类型分别核对 manifest 和 PKM 笔记。

## 阻塞 / 待定

- 无。
