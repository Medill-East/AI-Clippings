---
name: wechat-filehelper-web-ingest
description: 通过 WeChat Web (wx.qq.com) 自动提取「文件传输助手」聊天记录中指定时间段内的微信文章链接，并维护本地去重索引。
---

# WeChat FileHelper Web Ingest

通过 Playwright 自动化 WeChat Web，滚动浏览「文件传输助手」聊天记录，提取文章链接并写入本地 JSONL 索引。

**平台**：macOS / Linux / Windows（需要 Node.js 18+）
**前置条件**：微信账号支持网页版（wx.qq.com 可扫码登录）

## 快速开始

```bash
cd wechat-filehelper-web-ingest
npm install
npm run setup        # 初始化本地目录，首次运行必须执行
```

## 提取链接（Scan）

```bash
node scripts/scan-links.js --since 2026-03-22T15:00:00+08:00 --until 2026-03-22T23:59:59+08:00
```

**参数：**
- `--since <ISO8601>`：开始时间（含）
- `--until <ISO8601>`：结束时间（含）
- `--max-scrolls N`：最大向上滚动次数（默认 50，最大 200）
- `--reindex`：清空现有索引，全量重建

**首次运行**：浏览器窗口会打开并跳转到 wx.qq.com，请扫描二维码登录；后续运行复用已保存的 session，无需重新扫码。

## 查询索引（Query）

```bash
node scripts/query-links.js --since 2026-03-22T15:00:00+08:00 --until 2026-03-22T23:59:59+08:00 --format md
```

**参数：**
- `--since / --until`：时间范围
- `--format text|json|md`：输出格式（默认 `text`）

## 索引格式

`local/index/links.jsonl`，每行一条记录：

```json
{
  "captured_at": "2026-03-22T15:30:00+08:00",
  "message_time": "2026-03-22T15:12:00+08:00",
  "chat_name": "文件传输助手",
  "message_type": "share_card",
  "title": "文章标题",
  "url": "https://mp.weixin.qq.com/s/...",
  "dedupe_key": "<sha256>",
  "capture_session_id": "<uuid>"
}
```

## 运行产物

- `local/browser-profile/`：Playwright 持久化浏览器 profile（保存登录状态）
- `local/index/links.jsonl`：去重链接索引
- `local/runs/<timestamp>/manifest.json`：每次运行的统计摘要

## 跳过规则

- **视频号**（channels）卡片：跳过（无直接 URL）
- **B 站视频卡片**（无法提取直接 URL 的）：跳过
- **普通文本 B 站链接**：保留
- **无法提取 URL 的卡片**：跳过（通用 fallback）

## 常见问题

**账号不支持网页版**：若 wx.qq.com 显示「该微信号无法登录微信网页版」，此 skill 无法使用，需改用桌面版方案。

**Session 过期**：删除 `local/browser-profile/` 后重新运行即可重新扫码。

**找不到「文件传输助手」**：确保微信账号中有文件传输助手聊天记录，或手动在微信中发一条消息激活它。

**选择器失效（微信更新后）**：查看 `references/wechat-web-ui.md`，使用 `--debug` 参数运行 scan 可输出当前 DOM 快照用于更新选择器。
