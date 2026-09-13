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

## 2126 用户指定保留阅读栏，实机验证受阻

决策：無涘（批次内不关闭文章，处理完成后统一关闭；可手动预开第一篇保持布局） ｜ 记录：Codex
session 01a09a8f-210e-79d0-93d2-85ee0836e9c7
trace-user-count: 8

- 菜单修补 a12bca2 已推送 origin/main，GitHub 实际运行副本已 fast-forward 至同一提交。
- 用户说明此前可能因切换到 Codex 导致截图空白；这是假设，未直接认定截图损坏。
- 21:24 本地 JXA 将 WeChat 置前并 AXRaise 后回读 frontmost=true；普通屏幕截图仍显示下层终端。CoreGraphics 枚举到 onscreen Weixin 主窗口 kCGWindowSharingState=0（ID 582，1470x923，原点 0,33）。因此至少此次截图失败不能仅由前台切换解释；尚未确定是哪项设置或应用行为导致。
- CUA 重新初始化后截图仍为空白；不修改微信保护或注入。需用户提供当前展开三点菜单的系统截图，确认菜单和统一关闭入口，再完成实机修复。
- 延后关闭尚未实现，不能宣称已完成。静态追踪确认还需保持左侧聊天区域的截图与滚动定位，否则现有全窗 0.62 比例会指向文章；先确认真实布局，避免堆叠未经验证的坐标。

原始对话：dialogues/2026-0913.md「1938 （未分类）」
