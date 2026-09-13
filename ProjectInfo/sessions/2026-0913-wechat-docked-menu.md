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

## 2156 完成保留阅读栏与结束清理

决策：無涘（已要求批次内不关闭、结束统一关闭，并提供当前布局截图） ｜ 记录：Codex
session 01a09a8f-210e-79d0-93d2-85ee0836e9c7

- 新增 docked-articles.js，runScan 默认读取本机 local/ui-layout.json（无文件保留旧路径）。本机/实际运行副本都写入 1470×923、chatWidth=735、tabCloseX/Y=905/27。窗口位置/尺寸变化即拒绝继续使用旧候选坐标。
- 左侧截图、剪贴板聚焦及滚动共用校准聊天范围；文章提取保持阅读栏，新的右侧标题未确认时返回 article_title_not_confirmed。标题捕获复用现有微信窗口截图方式，解决直接全屏捕获不可见问题；真实菜单 OCR 与 Copy Link 已验证可工作。因此此前截图阻塞已经有可行路径，不再要求用户继续截图。
- 真实单篇首次返回 title_not_confirmed，切换为项目原有 captureWindowScreenshot 后成功；随后连续 TRPG 与 Claude Science 两篇均 status=ok、URL 不同、逐篇关闭等待均为 0。证据：local/docked-verification/two-article-result.json。
- 首次最终清理用 Cmd+W 关闭了宿主主窗口，被 chat_window_missing 正确报告为失败。已恢复主窗口并改为标签自身 ×；复用已验证且仍打开的文章做 cleanup-only 实机测试，corrected-cleanup-result.json 为 closed / 2。after-cleanup.png 显示没有文章阅读栏，聊天主窗口完整保留。保留首次失败证据，没有将其覆盖成成功。
- 清理失败独立写 viewer-cleanup.json；扫描成功路径将结果纳入 manifest，失败时保存索引/manifest 后再抛错。扫描异常也执行清理并保留原始异常。纯单元回归覆盖延后关闭、聊天范围、尺寸拒绝、空截图失败、标签不变化停止、异常收尾和左侧标题不能冒充右侧当前文章。
- 最终全量测试：206 pass / 0 fail，/tmp/clippings-final-release-tests.log；未批量收集历史、未调用付费摘要、未新写 PKM。菜单修补和本次功能将提交、推送并 fast-forward 到 GitHub 运行副本。

原始对话：dialogues/2026-0913.md「1938 （未分类）」

- 21:58 补充启动防误操作：未预开文章时 preflight 明确返回 docked_article_not_open；实机已验证当前关闭阅读栏状态能被识别，auto 不回退到错误的全窗剪贴板扫描。新增测试后全量 206/206 通过。
