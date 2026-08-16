---
name: wechat-filehelper-macos-ingest
description: 通过 macOS 微信桌面客户端优先走 UI-first 单篇文章扫描、必要时回退到剪贴板兜底，提取「文件传输助手」指定时间段内的文章链接，并把视频号卡片路由到独立待处理队列。
---

# WeChat FileHelper macOS Ingest

这个 skill 面向 **macOS 微信桌面版**，目标是从「文件传输助手」里提取指定时间段内的链接，并写入本地 JSONL 索引。

当前实现采用 **UI-first + clipboard fallback**：

- 主路线复用 Windows 版已经验证过的单篇文章思路：发现可见文章卡片、逐条打开、拿真实链接、关闭 viewer 后继续
- `auto` 会先探测 UI-first 路径是否可用；可用就走 `ui`
- 若 UI 环境不满足，则回退到 clipboard 扫描
- `store` 保留为诊断/实验来源，不再是默认主路线
- 明确识别的视频号卡片不再打开文章 viewer；会写入 `pending_item`，等待独立的视频采集、ASR 和总结流程
- 视频处理使用 ScreenCaptureKit 捕获微信播放时的系统音频，不保存完整视频；转录完成后只保留 Markdown 笔记和索引状态

## 平台要求

- **macOS only**
- Node.js 18+
- 微信桌面版已安装并登录
- 若需要 UI-first 或 clipboard fallback，终端应用要有辅助功能权限
- 若需要 UI-first，终端应用还需要屏幕录制权限

## 推荐流程

### 1. 初始化

```bash
cd wechat-filehelper-macos-ingest
node scripts/setup.js
```

### 2. 诊断 UI-first 路径

```bash
node scripts/diagnose-filehelper.js --json
```

重点看 `ui_probe.ui_probe_status`：

- `ready`：可以尝试 UI-first 单篇文章扫描
- `chat_not_ready`：当前不是文件传输助手，或标题 OCR 没有识别到它
- `ocr_empty`：当前微信窗口没有识别到可用聊天内容
- `screen_capture_failed`：通常是屏幕录制权限不足
- `vision_unavailable`：本机 Swift / Vision 运行环境异常

如果只想看 store 诊断：

```bash
node scripts/probe-store.js --json
```

### 3. 扫描链接

```bash
node scripts/scan-links.js \
  --since 2026-03-28T15:00:00+08:00 \
  --until 2026-03-28T23:59:59+08:00 \
  --source auto
```

可选数据源：

- `--source auto`：先 probe UI-first，可用就走 `ui`，否则回退 `clipboard`
- `--source ui`：强制走 UI-first 单篇文章扫描
- `--source store`：只允许使用本地库；不可读时直接报错
- `--source clipboard`：强制走剪贴板兜底

其他参数：

- `--max-scrolls N`：UI/clipboard 扫描最大翻页次数，默认 `50`
- `--reindex`：清空现有索引后重建
- `--debug`：输出详细调试信息

### 一条命令直接抓取并输出结果

如果你不想分成“扫描 + 查询”两步，可以直接用：

```bash
npm run collect -- \
  --since 2026-03-28T15:00:00+08:00 \
  --until 2026-03-28T23:59:59+08:00 \
  --source auto \
  --format md
```

`collect` 是文章和视频的统一入口。它会先完成扫描并输出文章、文本链接，让你先交给另一个 AI 处理；如果本次发现视频号卡片，随后在同一进程内询问是否继续视频分支。你准备好后按 Enter，脚本会提示播放视频并完成音频捕获、V2T 转录和 Obsidian 写回；输入 `n` 则跳过，视频仍保留在 pending 队列，不需要重新扫描。视频默认捕获 `120` 秒，可用 `--video-duration N` 调整；如确定只入队，使用 `--skip-video-processing`。

等价脚本：

```bash
node scripts/collect-links.js \
  --since 2026-03-28T15:00:00+08:00 \
  --until 2026-03-28T23:59:59+08:00 \
  --source auto \
  --format md
```

### 4. 查询索引

```bash
node scripts/query-links.js \
  --since 2026-03-28T15:00:00+08:00 \
  --until 2026-03-28T23:59:59+08:00 \
  --format md
```

### 5. 视频分支与失败重试

正常情况下视频由上面的 `collect` 在文章链接输出并确认后处理。此前已入队但未完成的记录，或本次输入 `n` 暂不处理的记录，可以单独重试：

```bash
npm run process:videos -- --duration 120
```

该重试命令会等待按 Enter，然后捕获指定时长的系统音频，调用本机 V2T 的 `qwen3-asr-0.6b`，再把摘要和完整转录写入当前打开的 Obsidian vault 的 `Video Clips/` 目录。中间只会生成短暂的低分辨率 MP4 作为音频容器，转换为 WAV 后立即删除，不保存视频文件。

常用参数：

- `--duration N`：视频语音时长，默认 `120` 秒
- `--all`：连续处理所有 pending 视频，每条都会单独等待准备
- `--output-dir DIR`：不解析 Obsidian 配置，直接把笔记写入指定目录
- `--vault-path DIR`：显式指定 Obsidian vault
- `--llm-base-url http://127.0.0.1:11434/v1 --llm-model <model>`：本地 OpenAI-compatible 摘要服务；默认探测本机 Ollama 并自动选择模型，不可用时使用转录句子的本地兜底摘要

视频处理要求终端具有**屏幕录制**权限，微信视频在捕获窗口内播放，并且本机已安装 `ffmpeg`。音频捕获只选取微信窗口所在屏幕；无法读取窗口位置时退回主屏。

## 索引格式

`local/index/links.jsonl` 每行一条记录。新增字段：

```json
{
  "captured_at": "2026-03-28T15:30:00+08:00",
  "message_time": "2026-03-28T15:12:00+08:00",
  "chat_name": "文件传输助手",
  "message_type": "share_card",
  "title": "文章标题",
  "url": "https://mp.weixin.qq.com/s/...",
  "dedupe_key": "<sha256>",
  "capture_session_id": "<uuid>",
  "source": "ui",
  "source_message_id": "optional-message-id"
}
```

视频号待处理项还会包含 `content_type: "video"`、`provider: "wechat_channels"`、`video_status: "pending"` 和 `pending_reason: "video_content_not_processed"`。处理成功后变为 `record_type: "video"`、`video_status: "resolved"`，并记录 `note_path`、`transcript_chars`、`summary_method`；失败项保留在 pending 队列并可重试。目前不保存完整视频或临时媒体 URL。

## manifest 重点字段

每次扫描会写入 `local/runs/<timestamp>/manifest.json`，重点关注：

- `source_requested`
- `source_selected`
- `ui_probe_status`
- `store_probe_status`
- `fallback_reason`
- `share_cards_seen`
- `share_cards_attempted`
- `share_cards_resolved`
- `share_cards_unresolved`
- `video_cards_pending`
- `browser_fallback_used`
- `skipped_by_rule`

## 内容分流规则

- 视频号卡片：进入独立视频 pending 队列，不打开文章 viewer
- B 站视频卡片和 `b23.tv` 短链：跳过
- 微信内部登录/跳转 URL：跳过
- 聊天记录合并卡片：第一版明确跳过
- 普通文本里的外部链接：保留

## 诊断工具

```bash
node scripts/inspect-accessibility.js [--depth N] [--window N]
```

这个脚本现在只保留为**诊断用途**。当前微信 macOS 版本的 AX 树通常接近空白，不能作为主提取方案。

## 常见问题

### UI-first probe 不是 `ready`

- `chat_not_ready`：先手动打开「文件传输助手」再重跑
- `ocr_empty`：检查微信窗口是否可见、是否被遮挡、是否有屏幕录制权限
- `screen_capture_failed`：通常是系统设置里还没给终端屏幕录制权限
- `vision_unavailable`：先确认系统有可用的 `swift` 和 `Vision`

### store probe 不是 `readable`

- `encrypted_unreadable`：本地消息库存在，但当前还不能直接读取，扫描会自动回退到 clipboard
- `missing`：先检查微信是否登录过、是否有活跃账号目录

### clipboard fallback 抓到 0 条

1. 确保微信桌面版正在运行且可见
2. 手动打开「文件传输助手」
3. 检查终端是否有辅助功能权限
4. 用 `--debug` 重跑并查看 manifest 的 `share_cards_unresolved` / `skipped_by_rule`

### 分享卡片没有被入库

当前版本的优先解决方式是：

- 先用 `node scripts/diagnose-filehelper.js --json` 看 `ui_probe_status`
- UI-first 就绪时，单篇文章卡片会走 viewer 菜单提取
- clipboard fallback 仍然只负责真实文本 URL，不会伪造文章卡片成功
