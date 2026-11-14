# wechat-macos-ingest-fix

> 按主题一份，追加不覆盖；同一场会话的节就地更新。

## 1510 修复macOS扫描时间推断与卡片门禁

决策：無涘 ｜ 记录：codex（自动）｜ session 019d37d9-9090-7753-b554-6ad485b7ced9

已完成macOS微信filehelper ingest的5/17扫描修复。根因两条：window_assumed要求运行时间落入窗口，导致12:27扫00:00-11:59时缺时间卡片全被误判为missing_timestamp；viewer候选门槛仅要求shareCardTitle且无skipReason，导致图片/普通文字/符号块误入。核心修复：同日中国日期窗口不再要求运行时刻落入窗口，改用clamp(scanNow, since, until)推断；viewer候选统一收敛到single_article_card/text_share_card/direct URL三类型；图片、普通文字、符号类OCR块前置写入skipped，不进viewer。产出：ui.js与ui.test.js补丁，新增同日窗口推断、历史窗口pending、图片/文字/符号跳过三类回归测试；UI测试63/63、全量npm test 123/123、git diff --check全部通过。风险：同日窗口推断召回优先于边界精度，可能多收少量靠近until的无时间卡片，但已用window_assumed明确标注；未运行真实微信UI collect以免干扰用户当前微信窗口。下一步：可复跑collect命令做实际验收；工作区保留此前已有query.js改动及无关的wechat-filehelper-web-ingest/package-lock.json未跟踪文件。

原始对话：dialogues/2026-0829.md「1510 wechat-macos-ingest-fix」

## 1516 wechat-filehelper 项目上下文梳理与双 checkout 定位

决策：無涘 ｜ 记录：codex（自动）｜ session 019e5902-a5f3-7d42-9fa8-ab9818829438

用户重开会话，要求 AI 理解 wechat-filehelper-macos-ingest 项目。AI 定位了两个 checkout：当前在 /Users/haodong/Documents/AI/Codex/Clippings（停在 14913fd），旧记忆指向 /Users/haodong/Documents/GitHub/AI-Clippings（已到 b153895，有 4 个未提交 WIP 文件）。当前 checkout 跑 npm test 得 94/96，2 个失败是 test/query-links.test.js 硬编码了旧路径；旧 checkout 123/123 全绿。AI 梳理了项目核心流程：collect = scan + query，scan 优先 UI/OCR 识别卡片后回退 clipboard，query 按时间输出文本/JSON/Markdown。最后用户要求以 Director 视角回答项目定义、背景、进展、非目标、风险五个问题，AI 确认文章链路已稳定，视频号 pending 队列已接入但自动播放/真实场景验证未完成，Bilibili 和纯视频链接暂不处理，视频依赖屏幕录制权限和 ffmpeg 等外部工具。

原始对话：dialogues/2026-0829.md「1516 wechat-macos-ingest-fix」

## 1938 修复微信升级后文章与视频号收集流程

决策：無涘 ｜ 记录：codex（自动）｜ session 01a09a8f-210e-79d0-93d2-85ee0836e9c7

微信升级后文章阅读改为内嵌阅读栏，旧窗口定位逻辑失效，导致菜单点击偏移、截图区域错误、候选漏检。本次会话聚焦修复：将菜单坐标改为固定边距适配新布局；改为批次结束后统一关闭阅读栏；扩大点击适配覆盖图片转公众号路径；修正候选生成、跨午夜时间归属和重复计数；调整视频号分享按钮在右半区的定位。实测连续两篇提链成功，最终运行补全漏检的 Nicky Case 文章与视频号链接，合并去重后产出 19 篇文章 +1 个视频号共 20 个唯一链接清单，测试用例增至 222 个。风险在于上轮曾扩大改动范围并误判原有时间处理逻辑，已收窄至仅点击适配。下一步无需重跑整批，以同步后的脚本继续使用。

原始对话：dialogues/2026-0913.md「1938 wechat-macos-ingest-fix」

## 1608 2026-09-14 公众号文章与视频号批处理

决策：無涘 ｜ 记录：codex（自动）｜ session 01a07586-ac29-72c3-892d-0dcb50e1c300

处理 2026-09-14 导出的 WeChat 链接清单：19 条公众号文章 + 1 条视频号。文章批次遇到与上次相同的并发错配问题（2 条 URL→tab 绑定错误），通过串行重跑受影响文章修复，错误副本移入可恢复隔离区。视频管线走完整流程：解析→下载→本地 ASR（24/24 分片）→Codex 摘要（526 字，8 个要点）→写入笔记。无需重新登录。最终验收：19/19 文章精确源 URL，1/1 视频完整产物。测试通过（文章 17/17、视频 222/222）。已提交并推送至远端 f3b673e。

原始对话：dialogues/2026-0914.md「1608 wechat-macos-ingest-fix」
