# ProjectProgress

> 现状快照，覆盖写，不堆历史。历史看 `ProjectInfo/sessions/` 与 `ProjectInfo/dialogues/`。

*更新于 2026-08-29 · 记录者 Codex*

## 现在在哪

- 两份本地仓库的分叉历史已通过 merge commit `1310a87` 收束；GitHub `main`、Director 真源目录与旧 GitHub 工作副本已包含多屏菜单修复提交 `1457386`，继续沿同一历史演进。
- 裸链接现在由聊天内容区 OCR 独立恢复，支持单行和连续换行 URL；旧的右侧硬边界不再吞掉 `kmjn.org` 与 `en.itu.dk` 样本。
- 卡片去重不再使用标题前 10/14/18 字或公共页脚等弱别名；相似卡片允许再次提链，最终只按稳定消息身份与规范化 URL 去重。
- 图文 viewer 即使只出现部分文章壳也会继续尝试 Copy Link；视频号走专用分享面板取得 `/sph/`，失败时生成带阶段和错误码的 `unresolved_item`，不再静默跳过。
- 图片消息进入专用 viewer 后使用本机 Apple Vision OCR，生成确定性的 `image_ocr` 内容记录；高置信结果写入既有 Obsidian Clippings，低置信结果标为 `needs_review`，空 OCR、viewer 未打开与写回失败均保留显式状态。未引入外部模型或新网络调用。
- 查询层将 `image_contents` 与 `unresolved_items` 作为独立结果组；manifest 按 `direct_url / article / video_channel / image / unsupported` 记录 `seen`，且每项必须落到 `recorded / needs_review / uncertain / skipped / unresolved / deduplicated` 之一，不守恒时写清单后明确报错。
- 文章 viewer 的三点菜单与 Copy Link 都改为相对 viewer 自身矩形定位和局部 OCR，不再把跨显示器、不同缩放倍率的整屏 OCR 坐标映射为点击点。
- 完整验证为 155 pass / 0 fail；所有 JS 文件通过语法检查，`git diff --check` 通过。2026-08-29 在实际扩展屏布局下用单候选现场扫描，三点首探针命中，索引写入 `https://mp.weixin.qq.com/s/EX7dzr4PLRoYtYE9ITFfmw`；manifest 为 article `seen=1 / recorded=1 / unresolved=0`。

## 当前阶段

- 五类故障修复、PKM 分流、失败审计、多屏菜单修复、文档与自动化测试均已完成并推送。
- 普通文章的完整现场链路已经验收；裸链接、视频号与图片仍以自动测试和旧真实产物离线回放为主要证据，本场没有为它们扩大成批量现场调用。

## 下一步

- 下次正常运行 `wechat-filehelper-macos-ingest` 时继续按 manifest 的类型守恒核对直链、视频号与图片，不只看总成功数。
- 图片现场验收时同时检查查询输出的 `image_contents / unresolved_items` 与 Obsidian 图片笔记正文回读结果。

## 阻塞 / 待定

- 无代码阻塞。
- 视频号与图片尚缺本版本的新现场样本；这是验证覆盖范围，不是已知实现失败。
