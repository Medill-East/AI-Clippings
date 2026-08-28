# 微信混合内容扫描漏收诊断

## 2358 五类故障根因确认

决策：無涘（本次要求检查，未授权修改采集逻辑） ｜ 记录：Codex

### 结论

- 本次运行使用 GitHub 旧副本 `5126e6f`，而 Director 当前工作副本为 `b7b5ade`；两份历史分叉。旧副本没有现行视频号 `/sph/` Copy Link 与后台处理链。
- `candidates.json` 的 80 条结果为 24 resolved、4 unresolved、14 skipped、38 duplicate。多数 duplicate 是滚动重叠，但至少“南洋理工… / Friend Slop… / 众神的权柄（上）”三篇不同文章被旧版 OCR 指纹别名误伤，未被点击。
- 图文内容被拆成两个 OCR 指纹并共尝试 4 次；viewer 实际打开，但旧版要求公众号文章元数据壳，最终均为 `viewer_not_ready`，没有执行菜单 Copy Link。
- 视频号打开后被判为 `video_channel`，旧版通用 extraction-skipped 分支只写 `skipped_card`，没有生成 pending 或 `/sph/`。7 条记录包含跨页和簇拆分重复。
- 图片中的文字已经被 Vision OCR 读到，但只作为 `plain_text_block / weak_ocr_card` 写入跳过记录；正式图片内容链不存在。
- 两个裸链接均在 OCR JSON 中：单行 URL 因 cluster 少于两行被丢；换行 URL 因文本左缘小于整屏右区硬阈值被丢。空剪贴板兜底没有恢复它们。
- 当前新版已覆盖视频号并放宽 viewer ready，但真实 OCR 离线回放仍漏两条裸链，图片链仍缺失，前 10 字去重仍有上下篇碰撞风险。

### 验证

- 旧副本 `node --test test/ui.test.js`：91 pass / 0 fail。
- 当前副本 `node --test test/ui.test.js`：48 pass / 0 fail。
- 用当前 `buildUiSnapshot` 回放本次 page 15 与 page 18 OCR：`directUrlEntries` 均为 0。
- 未触发新一轮微信扫描，未修改生产代码。

### 风险与下一步

- 测试全绿是覆盖缺口，不是采集完整性的判据；必须把本次 artifacts 转成红灯回归样本。
- 若授权修复，先收束唯一真源，再将去重、图文、视频、图片、裸链接拆成五个可独立归因的改动；最后以逐消息对表做一次真实批次验收。
- 图片 OCR 需定义正式记录与失败状态，不能继续以 skipped raw text 代替已收录内容。

### 产出

- 更新 `ProjectInfo/ProjectProgress.md`。
- 新增本会话 dialogues 与 sessions 留痕。
- 未修改采集、视频处理或 Obsidian 代码。

原始对话：dialogues/2026-0828.md「2358 微信混合内容扫描漏收诊断」

## 0001 微信混合内容采集故障诊断与修复实施

决策：無涘 ｜ 记录：Codex ｜ session 01a04911-d358-7e61-90e5-0a13d7881c0e

### 结论

- 分叉历史已在 `1310a87` 收束，Director 真源的现行视频号架构保留，旧 GitHub 历史成为祖先；功能与文档交付至 `331e39b` 并以 fast-forward 推送 GitHub。
- 五类缺陷均已实现修复：保守卡片去重；图文 partial viewer 继续 Copy Link；视频号专用 `/sph/` 提链；图片 viewer 本地 OCR 与 Obsidian 写回；单行及跨行裸链接恢复。
- 图片内容以 `image_ocr` 独立建模，高置信结果写入 PKM，低置信结果 `needs_review`；提链、viewer、OCR、写回失败均以 `unresolved_item` 显式留痕。
- 查询新增 `image_contents / unresolved_items`；manifest 建立按类型的互斥结果账本，不守恒时不得宣称扫描成功。

### 验证

- `git diff --check` 与全部 JS 语法检查通过。
- `npm test`：154 pass / 0 fail。
- 2026-08-28 真实产物 page 15–20 离线回放：5 个预期直链页面全部恢复；6 页都有图片候选；第 19 页相同图片只保留一个候选。
- 本轮没有执行新的微信现场扫描，因此现场验收状态明确为“待运行”，不以离线结果替代。

### 风险与下一步

- 下次正常采集应做一次小批次逐类型对表，同时核验 manifest 守恒、查询分组和 Obsidian 图片笔记回读。
- 本场经历上下文压缩，早期回合以 dialogues 原文为准。

### 产出

- 设计：`docs/superpowers/specs/2026-08-29-wechat-mixed-content-ingest-design.md`。
- 计划：`docs/superpowers/plans/2026-08-29-wechat-mixed-content-ingest.md`。
- 核心提交：`9f24fc2`、`4517e9c`、`11aae3f`、`1480456`、`331e39b`。

原始对话：dialogues/2026-0829.md「0001 微信混合内容采集故障诊断与修复」
