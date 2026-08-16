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

## 轻量视频总结讨论

- 用户希望把视频号卡片像文章一样总结进 PKM，但不想保存完整视频。
- 可行设计是：FileHelper 作为输入队列；打开并播放一次视频；本地捕获播放音频；按短片段转录；生成临时 transcript 页面；复用 Obsidian Web Clipper；成功后删除视频/音频临时数据。
- 该方案不等于零下载：音频字节仍必须被接收和处理，但不会保存完整 MP4。没有分享 URL 时也可以按当前卡片和播放会话捕获，URL 仅作为来源增强项。
- 后续实现前需确定 ASR 方式：本地模型或外部服务，以及是否接受首次模型下载/音频外发。

## 分支架构决策

- 用户确认文章处理和视频号处理应拆成两条线：文章保持现状，视频号独立获取信息、内容并总结。
- 推荐在 OCR 卡片分类后路由：文章进入现有 viewer 提链；视频号进入独立 video worker，不再依赖文章标题匹配和 Copy Link 成功。
- 视频 worker 自己管理 `pending`、`processing`、`resolved`、`failed`，避免视频失败污染文章去重或重试状态。
- 共享的只有输入卡片指纹、时间范围、运行记录和最终 Obsidian 发布接口；媒体捕获、ASR、清理逻辑完全隔离。
- 默认先实现分流和待处理记录，再逐步加入 metadata、临时音频转录和临时 transcript 页面。

## 本轮 V2T 实现记录

- 用户确认可以把文章和视频号拆成两条处理线，并指出之前 V2T 项目应已有本地 ASR 模型。
- 检查到 V2T 的 `sherpa-onnx` worker 和本地模型状态可用；默认选择 `qwen3-asr-0.6b`。没有读取或记录 V2T 的云端凭据文件。
- 在 macOS ingest 中新增 `scripts/lib/video.js`，隔离视频 pending record、V2T worker 路径/模型解析、WAV IPC 转录和错误码；`ui.js` 只负责把明确视频号 OCR 卡片路由进去，不再打开文章 viewer。
- 更新扫描 manifest 和 skill 文档，记录 `video_cards_pending`，并说明视频号目前只进入 pending 队列，不保存完整视频或临时媒体 URL。
- 新增视频 helper、worker 路径、runtime 传递和 UI 分流测试；修正一条原有时间归组测试，使中间视频号卡片的预期改为 pending 而不是 skipped。
- 实际运行本地 Qwen3 V2T worker 处理已有测试 WAV，输出 235 个转录字符；项目完整测试 155 项通过。

## 当前未完成

- 尚未实现微信视频播放音频的临时捕获、ASR 后摘要和 Obsidian 写回。这些应作为独立 video worker 继续开发，避免重新触碰文章提链主链路。

## 本次继续实现：视频分支闭环

### 用户目标

- 用户要求把前面确认的独立视频号处理线完善到可用：不下载完整视频，利用本机 V2T 的 ASR，最终总结到 PKM/Obsidian。

### 实现过程

- 检查到 macOS 有 ScreenCaptureKit SDK、`ffmpeg` 和已有 V2T 本地模型；没有虚拟声卡，因此采用系统音频捕获而不是 AVFoundation 麦克风输入。
- 新增 Swift helper：按传入的微信窗口矩形选择重叠面积最大的屏幕，使用 ScreenCaptureKit 的 `capturesAudio` 录制极低分辨率短时 MP4。Node wrapper 编译并缓存 helper，调用 `ffmpeg` 提取 WAV，最后清理整个临时目录。
- 新增视频 pipeline：读取 `content_type=video` 的 pending 记录，先写 processing 状态；捕获失败、ASR 失败或写笔记失败时写回 failed 状态和可重试错误码；成功时改成 `record_type=video/video_status=resolved`，只在索引保留摘要摘录、笔记路径和转录字符数。
- 新增 `npm run process:videos`。默认处理一条 pending 视频，提示用户在微信中准备并播放目标视频；支持 `--duration`、`--all`、`--vault-path`、`--output-dir`。
- Obsidian vault 从 macOS 配置自动选择当前打开的 vault，默认目录为 `Video Clips/`。摘要默认探测本机 Ollama 的 OpenAI-compatible API 并自动选择第一个模型，也支持 `--llm-base-url`/`--llm-model`；本地服务不可用时使用确定性的转录句子兜底摘要。
- 查询输出增加 `videos`/“已处理视频”区域，文章记录仍按原有 URL 逻辑输出。

### 验证记录

- Swift helper 编译成功。
- 实际执行 1 秒 ScreenCaptureKit 捕获，成功得到带音频轨的临时 MP4，并转出 16 kHz 单声道 WAV。
- 用系统语音合成生成的测试 WAV 跑真实 Qwen3 ASR，实际完成转录、Markdown 写入和索引 resolved 更新。
- 本地 Ollama 摘要调用首次加载约 8 秒成功；摘要超时仍可回退，不阻塞 note 写入逻辑。
- 视频和查询定向测试通过；最终完整测试与 `git diff --check` 在提交前复跑。

### 当前限制与后续

- 需要用户手动打开/播放视频并指定捕获时长；当前不自动点击历史 pending 卡片，也不自动检测播放结束。
- 捕获的是目标屏幕的系统混音，处理时应避免其他声音；完整视频不会留存。
- 视频号分支已可用，B 站视频仍保留原有跳过策略，后续如需支持再扩展 provider。

## 用户反馈后的入口调整

- 用户指出不应让文章处理和视频处理变成两条需要手动串联的命令。
- 将视频编排抽成共享 `processPendingVideos`，由 `collect-links.js` 在本次扫描写入索引后自动调用；只有发现本次扫描的视频卡片时才进入提示、捕获和 ASR，普通文章扫描保持原路径。
- `process-videos.js` 继续复用同一编排器，定位为历史 pending/失败记录的补救命令，而不是常规入口。
- 新增 `runCollect` 集成测试和 `processPendingVideos` 编排测试；增加 `--video-duration`、`--video-no-prompt`、`--skip-video-processing` 等 collect 兼容参数。

## 视频处理确认时序调整

- 用户进一步明确：文章/文本链接应先完整输出，以便立即交给另一个 AI 处理；视频号不能在这之前开始捕获、ASR 或写入 Obsidian。
- `collect` 仍是单一入口，但改为先打印当前查询结果，再提示“按 Enter 继续处理视频，输入 n 跳过”。确认后才调用共享的 `processPendingVideos`；跳过时不丢弃 pending 记录。
- 这样文章分支和视频分支仍然是两条独立处理线，但用户不需要再启动第二条扫描命令；`process:videos` 只负责历史 pending/失败项的重试。
