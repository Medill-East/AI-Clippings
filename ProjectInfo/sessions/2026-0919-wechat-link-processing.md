# Session: 微信链接补处理与 ASR 性能核查

*更新于 2026-09-19 · 记录者 codex*

## 1936 微信链接补处理与 ASR 性能核查

决策：無涘确认按已批准上限处理两批链接 ｜ 记录：codex ｜ session 01a09a8f-210e-79d0-93d2-85ee0836e9c7
trace-user-count: 26

- 处理范围是 14 篇公众号文章与 12 个视频号分享短链，内容去重后为 7 个唯一视频；没有重新扫描微信。
- 文章 manifest 的 14 条均成功，逐条核实请求 URL、剪藏目标 URL 和 PKM 笔记一致。
- 首次视频批次的 7 个唯一项均在摘要阶段失败；按确认上限逐条处理后，7/7 生成摘要和要点并写入笔记。没有视频摘要失败，因此没有触发停止条件。
- 一次续跑曾中断于 27/36 个 ASR 分片；恢复使用同一 task ID，只补剩余分片并完成写入。对应的 10:30 旧 manifest 仍标为 running；10:59 新 manifest 和 task.json 显示该任务已 written。
- 性能核查确认视频和 ASR 分片均串行，worker 数为 1；V2T auto 配置 5 个 Sherpa 线程。实测单 worker 瞬时约 97%–181% CPU，可能贡献卡顿；Activity Monitor 中会显示为短暂的 node/asrTranscriptionWorker.js。完成后的检查没有 ASR 进程；同时 WindowServer 和 Codex 图形进程占用较高，不能仅凭快照断定唯一根因。后续五条视频使用 nice 19。
- 全部 21 个唯一源链接清单位于被 Git 忽略的 wechat-filehelper-macos-ingest/local/exports/。由于远端是公开仓库，个人链接清单和原始日记留在本机；仅推送不含具体源链接的项目状态和会话摘要。
- 没有改动采集代码；以实际运行 manifest、PKM 文件、源链接和摘要章节回读验收，没有另跑测试。

验收材料：文章 manifest obsidian-web-clipper-ingest/local/runs/2026-09-19T10-22-02-040Z/manifest.json；视频源 manifest wechat-filehelper-macos-ingest/local/video-channel/runs/2026-09-19T03-52-37-185Z/manifest.json；七个成功重处理 manifest 见 ProjectProgress.md。

原始对话：dialogues/2026-0913.md「1938 微信公众号收集修复与链接补处理」。
