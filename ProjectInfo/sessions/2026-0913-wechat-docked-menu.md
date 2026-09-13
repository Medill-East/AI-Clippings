# 微信内嵌文章菜单定位修补

## 1949 最小定位修改

决策：無涘（要求只改找菜单的位置、复用后续流程） ｜ 记录：Codex
session 01a09a8f-210e-79d0-93d2-85ee0836e9c7
trace-user-count: 2

- 实机微信 4.1.13：文章在 Weixin 主窗口右侧内嵌，窗口从 735 pt 展开至 1470 pt。旧首探针位于 (1404,53)，正确菜单入口为 (1438,60)，主窗口原点 (0,33)。
- 仅修改 scripts/lib/ui.js 的 buildViewerMenuProbePoints：主窗口名为 Weixin/WeChat/微信时按右边缘 32 pt、顶边缘 27 pt 点击；其他 viewer 保留原探针。未改复制链接、关闭、扫描及 Web Clipper。
- 新增回归先失败，修改后 ui.test.js 80 pass / 0 fail；测试通过真实 openViewerMenu 路径及既有 Copy Link 路径，覆盖非零窗口原点。
- 用户另明确允许现有 AppleScript 做一次单篇打开/复制/关闭测试，不发送消息、不批量采集。真实新坐标点击后 AX 窗口多出菜单：position [1179,70], size [296,516]。截图未能读取该菜单，真实复制链接与连续扫描未验收；不能宣称整条流程已恢复。
- CUA 点击返回 noWindowsAvailable；普通截屏不显示微信，截图快捷键出现 PixPin 覆盖层。保留这些环境限制，不扩展修复范围。
- 实际运行副本为 /Users/haodong/Documents/GitHub/AI-Clippings；本轮提交后将以 fast-forward 同步。当前工作区既有其他未提交改动不纳入提交。

原始对话：dialogues/2026-0913.md「1938 （未分类）」
