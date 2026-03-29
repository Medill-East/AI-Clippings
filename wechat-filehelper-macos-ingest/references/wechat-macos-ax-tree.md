# WeChat macOS Accessibility Tree Reference

`inspect-accessibility.js` 现在主要用于**确认 AX 树为什么不能当主方案**，而不是继续基于 AX 树开发完整提取器。

## Current Observation On This Machine

已保存的一次真实 dump 显示，当前微信 macOS 桌面版的 AX 树几乎只暴露了窗口壳和系统按钮：

```text
[AXWindow]  subrole=AXStandardWindow  title="Weixin"  desc="standard window"
  [AXButton]  subrole=AXCloseButton  desc="close button"
  [AXButton]  subrole=AXFullScreenButton  desc="full screen button"
    [AXGroup]  desc="group"
      [AXGroup]  desc="group"
  [AXButton]  subrole=AXMinimizeButton  desc="minimize button"
```

这意味着当前版本下：

- 聊天列表没有稳定暴露
- 文件传输助手会话项没有稳定暴露
- 消息滚动区和消息气泡没有稳定暴露
- 时间分隔符和分享卡片没有稳定暴露

所以 `wechat-filehelper-macos-ingest` 现在采用：

- **主方案**：UI-first 单篇文章扫描
- **辅助诊断**：本地微信消息库探测
- **兜底方案**：clipboard fallback
- **AX 脚本**：仅保留为诊断工具

## How To Re-Run

```bash
node scripts/inspect-accessibility.js --depth 8
```

输出会写入：

- `local/runs/<timestamp>/ax-tree-dump.txt`
- `local/runs/<timestamp>/ax-tree-dump.json`

## What Would Change The Strategy

只有在未来微信更新后，AX 树重新稳定暴露以下元素时，才值得重新考虑 AX 主方案：

- 文件传输助手会话入口
- 消息列表容器
- 单条消息气泡
- 时间分隔符
- 分享卡片可点击节点或真实 URL 节点

在那之前，不要再把 AX 树当作主抓取路径。
