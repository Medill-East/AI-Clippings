---
name: wechat-filehelper-macos-ingest
description: 通过 macOS 微信桌面客户端优先走 UI-first 单篇文章扫描、必要时回退到剪贴板兜底，提取「文件传输助手」指定时间段内的链接并维护本地索引。
---

# WeChat FileHelper macOS Ingest

这个 skill 面向 **macOS 微信桌面版**，目标是从「文件传输助手」里提取指定时间段内的链接，并写入本地 JSONL 索引。

当前实现采用 **UI-first + clipboard fallback**：

- 主路线复用 Windows 版已经验证过的单篇文章思路：发现可见文章卡片、逐条打开、拿真实链接、关闭 viewer 后继续
- `auto` 会先探测 UI-first 路径是否可用；可用就走 `ui`
- 若 UI 环境不满足，则回退到 clipboard 扫描
- `store` 保留为诊断/实验来源，不再是默认主路线

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

## 跳过规则

- 视频号卡片：跳过
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
