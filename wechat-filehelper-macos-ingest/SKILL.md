---
name: wechat-filehelper-macos-ingest
description: 通过 macOS WeChat 桌面客户端的辅助功能 API 自动提取「文件传输助手」聊天记录中的文章链接，并维护本地去重索引。适用于微信账号不支持网页版的情况。
---

# WeChat FileHelper macOS Ingest

通过 macOS WeChat 桌面客户端的辅助功能（Accessibility）API，自动扫描「文件传输助手」聊天记录中的文章链接并写入本地 JSONL 索引。

## 平台要求

- **macOS only** (不支持 Windows/Linux)
- Node.js 18+（无需额外 npm 依赖）
- 微信桌面版已安装并登录
- 终端应用已获得辅助功能权限（见下方说明）

## 首次使用

### 1. 授予辅助功能权限

在 **系统设置 > 隐私与安全性 > 辅助功能** 中，添加并启用你的终端应用（Warp、Terminal.app、iTerm2 等）。

### 2. 初始化

```bash
cd wechat-filehelper-macos-ingest
node scripts/setup.js
```

### 3. 诊断（可选但推荐）

首次运行前，先用诊断工具确认辅助功能 API 能正确读取微信界面：

```bash
node scripts/inspect-accessibility.js
```

输出会保存到 `local/runs/<timestamp>/ax-tree-dump.txt`。

## 扫描链接

```bash
node scripts/scan-links.js \
  --since 2026-03-28T15:00:00+08:00 \
  --until 2026-03-28T23:59:59+08:00
```

**参数：**

| 参数 | 说明 | 默认值 |
|------|------|--------|
| `--since <ISO8601>` | 开始时间（含） | 必填 |
| `--until <ISO8601>` | 结束时间（含） | 必填 |
| `--max-scrolls N` | 最大向上滚动次数 | 50 |
| `--reindex` | 清空现有索引后重新建立 | false |
| `--debug` | 输出详细调试信息 | false |

运行时微信桌面版需处于**可见状态**（不能最小化）。脚本会自动将微信切换到前台，导航至文件传输助手，然后滚动聊天记录提取链接。

## 查询索引

```bash
node scripts/query-links.js \
  --since 2026-03-28T15:00:00+08:00 \
  --until 2026-03-28T23:59:59+08:00 \
  --format md
```

**参数：**

| 参数 | 说明 | 默认值 |
|------|------|--------|
| `--since <ISO8601>` | 开始时间（含） | 必填 |
| `--until <ISO8601>` | 结束时间（含） | 必填 |
| `--format text\|json\|md` | 输出格式 | text |

## 索引格式

每条记录为一个 JSON 对象（JSONL 格式，每行一条）：

```json
{
  "captured_at": "2026-03-28T15:30:00+08:00",
  "message_time": "2026-03-28T15:12:00+08:00",
  "chat_name": "文件传输助手",
  "message_type": "share_card",
  "title": "文章标题",
  "url": "https://mp.weixin.qq.com/s/...",
  "dedupe_key": "<sha256>",
  "capture_session_id": "<uuid>"
}
```

## 跳过规则

| 内容类型 | 处理 |
|---------|------|
| 视频号卡片 | 跳过 |
| B站视频卡片 | 跳过 |
| 普通文本中的 B站链接 | **保留** |
| 其他文章链接 | 保留 |

## 诊断工具

```bash
node scripts/inspect-accessibility.js [--depth N] [--window N]
```

输出微信窗口的辅助功能 API 元素树，用于调试或在微信版本更新后重新发现界面结构。结果记录在 `references/wechat-macos-ax-tree.md`。

## 常见问题

### 辅助功能权限不足

错误提示包含 "not allowed assistive access" 时：
- 前往 **系统设置 > 隐私与安全性 > 辅助功能**
- 添加并启用你的终端应用（Warp、Terminal.app 等）

### 微信未运行

确保微信桌面版已打开并登录，**不要最小化**。

### 提取到 0 条链接

1. 运行 `node scripts/inspect-accessibility.js` 查看 AX 树结构
2. 确认微信界面能被辅助功能 API 读取
3. 尝试 `--debug` 模式查看详细日志
4. 可能需要根据 AX 树发现更新 `scripts/lib/chat.js` 中的选择器

### 微信版本更新后失效

重新运行 `node scripts/inspect-accessibility.js`，根据新的 AX 树结构更新 `references/wechat-macos-ax-tree.md` 和 `scripts/lib/chat.js`。
