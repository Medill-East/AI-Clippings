# ProjectProgress

> 现状快照，覆盖写，不堆历史。历史看 `ProjectInfo/sessions/` 与 `ProjectInfo/dialogues/`。

*更新于 2026-08-29 · 记录者 Codex*

## 现在在哪

- 两份本地仓库的分叉历史已通过 merge commit `1310a87` 收束；GitHub `main` 与 Director 真源目录已包含功能提交 `331e39b`，旧 GitHub 工作副本不再独立演进，可沿同一历史安全快进。
- 裸链接现在由聊天内容区 OCR 独立恢复，支持单行和连续换行 URL；旧的右侧硬边界不再吞掉 `kmjn.org` 与 `en.itu.dk` 样本。
- 卡片去重不再使用标题前 10/14/18 字或公共页脚等弱别名；相似卡片允许再次提链，最终只按稳定消息身份与规范化 URL 去重。
- 图文 viewer 即使只出现部分文章壳也会继续尝试 Copy Link；视频号走专用分享面板取得 `/sph/`，失败时生成带阶段和错误码的 `unresolved_item`，不再静默跳过。
- 图片消息进入专用 viewer 后使用本机 Apple Vision OCR，生成确定性的 `image_ocr` 内容记录；高置信结果写入既有 Obsidian Clippings，低置信结果标为 `needs_review`，空 OCR、viewer 未打开与写回失败均保留显式状态。未引入外部模型或新网络调用。
- 查询层将 `image_contents` 与 `unresolved_items` 作为独立结果组；manifest 按 `direct_url / article / video_channel / image / unsupported` 记录 `seen`，且每项必须落到 `recorded / needs_review / uncertain / skipped / unresolved / deduplicated` 之一，不守恒时写清单后明确报错。
- 完整验证为 154 pass / 0 fail；所有 JS 文件通过语法检查，`git diff --check` 通过。用 2026-08-28 真实运行的 page 15–20 OCR/快照离线回放，5 个应出现直链的页面全部恢复 URL，6 页全部重新形成图片候选，第 19 页图片候选只保留一个。

## 当前阶段

- 五类故障修复、PKM 分流、失败审计、文档与自动化测试均已完成并推送。
- 当前证据包含单元/集成测试与旧真实产物离线回放；本轮未主动操作微信做新的现场批次，因此不能把“离线验证通过”写成“新版本已现场验收”。

## 下一步

- 下次正常运行 `wechat-filehelper-macos-ingest` 时做一次小批次现场验收，逐项核对直链、普通/图文卡片、视频号与图片，而不是只看总成功数。
- 验收时同时检查 manifest 的类型守恒、查询输出的 `image_contents / unresolved_items`，以及 Obsidian 图片笔记正文回读结果。

## 阻塞 / 待定

- 无代码阻塞。
- 最终现场验收需要微信窗口中出现对应内容；这是尚未执行的验证步骤，不是已知实现失败。
