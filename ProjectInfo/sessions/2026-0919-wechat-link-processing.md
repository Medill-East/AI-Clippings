# Session: 微信链接补处理与 ASR 性能核查

*更新于 2026-09-19 · 记录者 Codex*

决策：無涘确认本轮两批链接均处理；视频摘要最多 7 次、逐条执行，遇到失败停止 ｜ 记录：Codex

## 1928 批次补处理与性能核查

- 范围为已准备的 14 篇文章和 12 个视频号分享短链（去重为 7 个唯一视频）；没有重新扫描微信。
- 文章 manifest 中 14/14 成功；每条请求 URL 与剪藏目标一致，笔记存在且包含对应 URL。
- 原视频运行的 7 个唯一项都曾在摘要阶段失败。按用户确认的范围逐条重处理，7/7 最终写入；每篇笔记都有源链接、摘要和关键要点，视频媒体与逐字稿在成功后清理。
- 一条 ASR 任务在工作段切换时停在 27/36；以相同 task ID 续跑，恢复已完成的分片，只补剩余 9 片。该次最终 manifest 为 complete。
- 性能结论：采集批次和 ASR 分片均为串行，worker 数为 1；V2T `auto` 在 10 个逻辑核的机器上配置 5 个线程。运行时曾观察到单 worker 约 97%–181% CPU，故它可以贡献负载，但并非多开 ASR。空闲时未见 ASR 进程；当时 WindowServer / Codex 图形进程仍占用较高，原因尚不能唯一归因。
- 完整清单和 21 行纯链接文件保存在被 Git 忽略的 `wechat-filehelper-macos-ingest/local/exports/`。当前 GitHub 远端为公开仓库，所以没有把这份个人剪藏链接清单提交或推送。
- 没有改动处理代码；本轮通过实际 manifest、PKM 文件与源链接回读验收，没有另跑测试。

原始对话：Codex task 01a09a8f-210e-79d0-93d2-85ee0836e9c7；逐字记录在本机 ProjectInfo/dialogues/2026-0919.md「1928 批次补处理与性能核查」。远端为公开仓库，含个人剪藏链接的原始日记留在本机，没有推送。

## 验收材料

- 文章：`obsidian-web-clipper-ingest/local/runs/2026-09-19T10-22-02-040Z/manifest.json`
- 视频源清单：`wechat-filehelper-macos-ingest/local/video-channel/runs/2026-09-19T03-52-37-185Z/manifest.json`
- 七个成功重处理 manifest 与链接清单：见 `ProjectProgress.md` 和 `wechat-filehelper-macos-ingest/local/exports/2026-0919-merged-wechat-links.md`。
