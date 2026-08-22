---
name: wechat-filehelper-macos-ingest
description: 通过 macOS 微信桌面客户端扫描「文件传输助手」的文章与视频号；文章交给既有 Obsidian Web Clipper，视频号短时提链后在后台转写、摘要并写入 Obsidian。
---

# WeChat FileHelper macOS Ingest

这个 skill 面向 **macOS 微信桌面版**，目标是从「文件传输助手」提取指定时间段内的文章与视频号。文章链接写入本地 JSONL 索引；视频号只在前台短时打开以复制 `/sph/` 链接，随后在后台完成媒体解析、本机转写、Codex 摘要和 Obsidian 写入，不等待播放器播完。

当前实现采用 **UI-first + clipboard fallback**：

- 主路线复用 Windows 版已经验证过的单卡片思路：发现可见文章或视频号卡片、逐条打开、拿真实链接、关闭 viewer 后继续
- `auto` 会先探测 UI-first 路径是否可用；可用就走 `ui`
- 若 UI 环境不满足，则回退到 clipboard 扫描
- `store` 保留为诊断/实验来源，不再是默认主路线
- `/sph/` 视频号链接由独立状态机处理：`pending → resolving → downloading → transcribing → summarizing → written`
- 元宝登录态只承担腾讯域内短链解析，不使用元宝总结或聊天产物

## 平台要求

- **macOS only**
- Node.js 18+
- 微信桌面版已安装并登录
- 若需要 UI-first 或 clipboard fallback，终端应用要有辅助功能权限
- 若需要 UI-first，终端应用还需要屏幕录制权限
- `ffmpeg` / `ffprobe`（当前默认路径 `/opt/homebrew/bin/`）
- 本机 V2T 已安装可用的 sherpa-onnx 模型
- 已登录的 Codex CLI（用于我们自己的结构化摘要）
- Obsidian 已有可解析的 vault；优先复用最近一次 Web Clipper 成功笔记的目录
- Playwright 复用仓库内 `obsidian-web-clipper-ingest` 的既有依赖

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

等价脚本：

```bash
node scripts/collect-links.js \
  --since 2026-03-28T15:00:00+08:00 \
  --until 2026-03-28T23:59:59+08:00 \
  --source auto \
  --format md
```

`collect` 默认会在微信扫描结束、viewer 全部关闭后继续后台处理该时间段的视频号。后台阶段不会操作微信或鼠标；文章与视频号会在查询结果中分组，`/sph/` 不会再进入文章 Web Clipper 数组。只有明确不想处理视频号时才加 `--skip-videos`。

### 端到端写回 PKM 的分流契约

采集完成后，两类链接走并列处理器，不互相代替：

- 再运行 `query-links.js --format json`，只把 `records[].url` 交给仓库内既有 `obsidian-web-clipper-ingest` skill；沿用它的并发摘要、失败重试和 vault 回读验收，不在本 skill 重写网页剪藏逻辑。
- `video_channels[].url` 已由 `collect` 的视频状态机在后台处理，不得再交给 Web Clipper；只有重试失败视频时才单独运行 `video:process`。
- `uncertain_links` 与 `skipped_cards` 不是文章输入。空数组要结合扫描 manifest 判断是确实没有该类型，还是采集通道失败。
- 整批完成需要分别核对文章 Web Clipper manifest 与视频号 manifest；一边成功不能代替另一边的结果。

### 首次建立元宝解析登录态

只需首次使用或登录过期时执行：

```bash
npm run video:auth
```

窗口出现后用微信扫码。登录信息只保存在 `local/yuanbao-profile/`，不得提交到 Git。

### 单独处理或重试视频号

```bash
npm run video:process -- \
  --since 2026-03-28T15:00:00+08:00 \
  --until 2026-03-28T23:59:59+08:00
```

也可只处理一条：

```bash
npm run video:process -- --url 'https://weixin.qq.com/sph/...'
```

成功任务再次运行会直接计入 `skipped`，不会重复下载、转写或写笔记。临时 MP4、WAV 和逐字稿在结束后默认删除；只有诊断时显式使用 `--keep-artifacts`。

### 4. 查询索引

```bash
node scripts/query-links.js \
  --since 2026-03-28T15:00:00+08:00 \
  --until 2026-03-28T23:59:59+08:00 \
  --format md
```

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
- `browser_fallback_used`
- `skipped_by_rule`

视频号批处理另写入 `local/video-channel/runs/<timestamp>/manifest.json`；每条任务的可恢复状态在 `local/video-channel/tasks/<task-id>/task.json`，自动化失败追加到 `local/video-channel/automation-failures.log`。重点核对：

- `counts.selected / written / skipped / failed`
- `state`
- `failed_stage`
- `error_code`（如 `auth_required`、`parse_rejected`、`media_missing`、`asr_empty`、`summary_invalid_json`）
- `media_bytes / media_duration_seconds`
- `transcript_chars / summary_chars / key_points_count`
- `note_path`

manifest 和 task 不保存解析 token、媒体签名 URL 或逐字稿正文。

## 跳过规则

- 视频号分享卡片：UI-first 自动打开，复制 `https://weixin.qq.com/sph/...` 后立即关闭 viewer；`collect` 随后在后台下载、转写、摘要并写入 Obsidian
- `channels.weixin.qq.com` 裸内部地址与 `mp.weixin.qq.com/mp/wma`：仍按不可直接消费的视频号内部 URL 跳过
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
- UI-first 就绪时，文章卡片会走文章 viewer 菜单；视频号卡片会走底部分享面板并接受 `/sph/` 分享链接
- clipboard fallback 仍然只负责真实文本 URL，不会伪造文章卡片成功

### 视频号显示 `auth_required`

- 执行 `npm run video:auth`，在独立窗口重新扫码
- 再用同一时间范围运行 `npm run video:process -- ...`
- 不要把 `auth_required` 当作“没有视频内容”；解析失败与内容不存在是不同状态

### 视频号后台失败

- 先看最新 `local/video-channel/runs/*/manifest.json` 的 `failed_stage` 与 `error_code`
- `parse_rejected`：元宝未公开解析接口可能漂移；不要返回空摘要兜底
- `media_missing` / `media_invalid`：官方 feed 没有可验证媒体，不能把封面 JPEG 冒充视频
- `asr_*`：检查 V2T 设置、模型文件和 `ffmpeg`
- `summary_*`：检查 Codex CLI 登录态与 JSON Schema 输出
- 默认失败也会清理临时媒体；确需诊断时用 `--keep-artifacts`
