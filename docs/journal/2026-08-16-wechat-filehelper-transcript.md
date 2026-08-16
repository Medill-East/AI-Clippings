# 会话记录：2026-08-16 WeChat FileHelper

> 导出状态：partial。本记录只覆盖本次会话可恢复的项目上下文与操作；更早的完整对话和工具逐字输出未在当前运行时可用。内容已脱敏，未写入凭据、密钥或环境变量。

## 用户请求

- 检查当前版本是否已提交；如果没有，先保存一个版本。
- 评估是否可以扩展提取范围，尤其是视频号和普通视频链接，并考虑后续 Obsidian 处理方式。

## 已确认事实

- Git 根目录为 `AI-Clippings`，当前文字卡片修复尚未提交。
- 未提交的代码只涉及 macOS ingest 的 OCR 逻辑和对应测试；无关的 web ingest lockfile 与系统文件不应加入提交。
- macOS ingest 对明确的视频号/Bilibili 视频会记录 skip reason；Obsidian ingest 当前只有 URL clipping 流程，没有转录或视频总结管线。

## 本次修复上下文

- 截图中的书籍卡片标题只有一行，来源 `第七艺术 ART TIME` 被 OCR 分成相邻的独立 cluster。
- 原逻辑把标题误判为来源行，未合并 footer，导致卡片不进入提链候选。
- 修复改为识别可信的单行书名/分隔符标题后做窄范围 footer 合并，并增加回归测试。

## 讨论结论

- 视频号能否自动总结首先取决于是否能获得稳定 URL 或可访问的页面内容；Obsidian Web Clipper 本身不会自动完成视频转录。
- 普通视频链接可按平台优先获取字幕/转录；没有字幕时再考虑本地 ASR，作为独立、可选的较重流程。
- 推荐分阶段：先保留视频 URL 和 `pending_video` 状态，再做字幕适配器，最后才考虑 ASR fallback。

## 待确认

- 首批平台、是否保存完整转录、是否允许外部转录服务，以及视频号无法取得 URL 时是否接受人工处理队列。

## 视频号公开方案调研

- 使用 agent-reach 的网页搜索、GitHub 搜索和网页阅读核对公开实现。
- 公开方案有两类：从视频号分享链接 `weixin.qq.com/sph/<id>` 解析详情/媒体；或在已登录微信 PC 播放时用本地代理捕获媒体请求。
- `ltaoo/wx_channels_download` 的公开文档显示，macOS 也受支持，但首次运行需要管理员权限和证书/代理路径；`parse_sph` 文档要求配置元宝 Web cookie。cookie 不应写入代码、日志或发送给第三方。
- `weixin-articles-mcp` 的公开说明认为视频号 mp4 受 finder 协议和加密保护；它选择调用公开 metadata 接口提供封面、描述、时长等信息，而不是获取 mp4。
- 对当前项目的建议是：先做一次性分享 URL 捕获并记录 `pending_video`，不要默认启用 MITM；若要总结，先走 metadata，真正需要音频内容时再单独启用本地媒体捕获和 ASR。
