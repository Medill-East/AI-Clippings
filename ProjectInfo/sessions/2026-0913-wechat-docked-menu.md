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

## 2026-09-13 22:26 +0800 整批失败审计

决策：無涘（要求检查漏采、时间范围和关闭错误） ｜ 记录：Codex
session 01a09a8f-210e-79d0-93d2-85ee0836e9c7

- 已检查运行副本 local/runs/2026-09-13T14-10-11 的 manifest、全部 candidates、27 行 index，以及 page-0/page-5/page-13 截图和各页时间 OCR；将原始 index 备份为该 run 的 index-snapshot.jsonl，不覆盖已有文件。
- 19 是失败记录数（12 image / 7 article），包含 OCR 变体重复、Send UI 假候选；不是真实唯一文章数量。46 seen、29 attempted、10 resolved、8 unique URL、15 duplicate_skipped；失败后重复可见也被 article_already_attempted 跳过，仍保留 unresolved，但不代表已经收录。
- 已确认文章误分类：Claude Science / UCSD / 初代 Mac 等真实卡片走 plain_text_block => image；内嵌阅读栏没有新图片窗口，故 image_viewer_not_opened。Send 在 y=921 的输入区被纳入候选。
- page-5.png 显示 Nicky Case 行之，明也卡片，candidates.json 无此标题；OCR 按固定 54px 间隔分簇、单行短簇过滤是需复现的直接实现路径。
- game-industry 与 PhD 两个不同标题记录同一个 _U4xaF5rHHMOLylWzwh8Lg 链接。两张 viewer-ready OCR 分别显示不同右侧实际文章标题，故存在真实 title-to-URL 错配，不是正常去重。复制旧值/菜单选择的具体成因尚未确认。
- 输入北京时间19:00与日志11:00Z等价。8个成功链接全为截止时间占位；findNearestTimestampLine 的180px距离限制导致跨卡片时间关联丢失，16:09独立时间线未触发范围停止，最后由Yesterday21:18结束。complete不代表所有项入库，也不能证明每条都在范围内。
- cleanup.closed=2 后 article_tab_not_closed；本轮没有清理截图留存（finish finally 删除临时截图），不能断言究竟是按钮漂移还是签名判断问题。需保留失败截图再验证。
- 本轮只完成诊断；尚未新增修复或整批验证。此前两条样本验收后的“已修好”结论过宽，当前快照已纠正。

原始对话：dialogues/2026-0913.md「1938 （未分类）」

## 2026-09-13 22:31 +0800 按用户要求恢复原处理流程，只保留点击适配

决策：無涘（明确只改点击，保留原来已跑通的处理流程） ｜ 记录：Codex
session 01a09a8f-210e-79d0-93d2-85ee0836e9c7

- 回查 ProjectInfo/sessions/2026-0828-wechat-mixed-content-scan-diagnosis.md 的 0342 节，确认无时间按查询上界占位并明确来源是此前设计。上一轮将此直接归为新流程错误不准确；时区换算仍正确。没有改动时间规则。
- 实际新增范围曾包括 docked session、裁切/聚焦、prepared viewer、强制标题门槛、startup gate、cleanup fatal。已撤销强制标题门槛与 cleanup fatal，恢复默认浏览器回退和原 waitForViewerReady。
- 用 Git de5c9d6 对比，scanUiLinks 完整循环、inferShareCardItemsFromOcr 至 mapOcrRectCenterToScreenPoint 之间的候选/分类函数及 waitForViewerReady 均逐字一致。chat/common/query 本轮没有改动。
- 原疑似图片分流依靠 viewer 类型确认后回到文章；新内嵌模式没有新图片窗口，之前适配漏接 extractImageContent，导致直接 image_viewer_not_opened。现加入 UI 检测 hook，使用既有标题匹配函数确认右侧文章并返回原 type_hint；下一次原 reroute 复用打开的 viewer，不重复开卡。
- 单篇旧验证直接调用 extractShareCardUrl，绕过原分类和图片转文章链路，不能证明整批可用。补充该点击适配的集成边界回归，不以测试通过冒充整批采集已修好。
- Copy Link 边界再次清空剪贴板，减少新截图路径恢复旧剪贴板对复制等待的干扰；已发现错配的具体成因仍不能完全确定。
- 收尾失败继续保存 viewer-cleanup.json/manifest 并显示警告，不中断既有 collect 后续处理。当前没有再次整批运行，不改原数据或重新定义 19 的含义。

原始对话：dialogues/2026-0913.md「1938 （未分类）」

## 2026-09-13 22:52 +0800 慢加载和前台 viewer 目标修正

决策：無涘（继续检查未处理卡片、慢视频及时间疑虑；原有只改点击的约束仍适用） ｜ 记录：Codex
session 01a09a8f-210e-79d0-93d2-85ee0836e9c7

- 读取最新失败 run 2026-09-13T14-33-06 manifest/candidates/OCR，备份23行 index至run/index-snapshot.jsonl。15唯一链接、8失败、8图片转公众号恢复，说明上一补丁确实接回部分旧流程；不是全量已解决。
- 最后viewer-context为Photos and Videos独立窗口，却被判断video_channel；对应video-share截图/OCR来自背后终端。新adapter总是capture current()主窗是直接错误，现改取实际前台独立viewer；主窗阅读器capture只取右侧，避免左边聊天标题误作reader已加载。
- detectEmbeddedArticleFn 原只读一次，现最多3帧、间隔400ms，读到匹配标题提前返回；视频号原waitForViewerReady直接return，现最多3帧等待加载正文（尚无正文时仍保留既有分享尝试，不伪造成功）。未调用视频解析/下载/ASR/摘要。
- 标签条后期OCR已出现“一种…X”在x2389宽320，而初始关闭点固定905pt。增加明确close glyph定位；拿不到仍使用原点并明确失败，失败截图保留到run artifacts。此定位尚未实机复验，不能宣称整批cleanup已经修好。
- 补充回归覆盖首帧Loading后转文章、独立Photos viewer截图目标、右侧文章截图范围、位移后的明确关闭glyph、慢视频正文等待。全量212/212，/tmp/clippings-loading-target-tests.log。
- 两次只读窗口查询及一次激活后仍返回WeChat windows=[]，本轮未进一步操控或整批重跑。
- 点击前的Gwen/Nicky Case漏检定位：两者OCR title y292/1086.7，footer y448/1242，文本均以“0 ”开头；旧固定54px把title/footer分开，两个单行簇被过滤。已向用户问是否允许最小候选修复（不改时间/去重），尚未获答复时不改该原逻辑。
- 时间说明保持既有语义：Z是UTC显示，文章发布日期不等于消息转发时间；扫描到旧消息用于停止不等于全部旧消息都已收录。已知16:09截图被无时间占位纳入unresolved的问题在开始边界一侧，不应误称晚于23:59:59。未擅改原时间策略。

原始对话：dialogues/2026-0913.md「1938 （未分类）」

## 2026-09-14 00:28 +0800 跨午夜运行计数与剩余问题核对

决策：無涘（询问是否收得更多、视频/起始边界和跳过原因） ｜ 记录：Codex
session 01a09a8f-210e-79d0-93d2-85ee0836e9c7

- 核对run 2026-09-13T16-13-21 manifest、全部candidate、当前index、video share OCR、viewer-context和cleanup失败截图。25行index已备份到该run/index-snapshot.jsonl。
- 19链接记录实际18不同URL。新凌晨文章5-L2xUqjhe1SkZAOIOaFdg一条message_time=00:09、一条按until占位；query.js再次按URL去重，输出18。比上轮15新增UCSD、Gwen、凌晨新文章3URL。不能把新增4条record说成4篇文章。
- duplicate_skipped22次=19 already_resolved+3 already_attempted，单位是重复可见事件，不是22篇漏收。Nicky Case在page5/6/7 OCR都有，却无candidate，是独立的候选漏检。
- Claude Science裸21:06由parseWeChatTimestamp强制用运行日，解析为9/14 21:06；运行完成于9/14 00:24，故是跨午夜日期归属错误，不能归咎UTC显示。旧无时间占位政策保持未改，但该实际时间错误须另做回归。
- 当前video-share三张OCR均为终端内容、没有Copy Link。最后context screen_rect为Photos and Videos，screen_bounds却为主窗右半，window也被刷新成主窗；active窗口生命周期/截图改变焦点仍未接对。没有/sph/成功记录，失败不能解释为无视频。
- cleanup-failed截图显示主窗仍开，右侧多tab压缩为图标，activeTRPG ×位置已移；固定905pt与基于可识别X的回退均不足以稳定清理。不会把猜测性再加等待当成修复完成。
- 本轮完成诊断和留痕，无代码更改、无整批重跑、无收费调用。此前候选修复的异步范围确认尚无明确回答，未擅改原候选/时间/去重。

原始对话：dialogues/2026-0913.md「1938 （未分类）」

## 2026-09-14 01:04 +0800 实施并验证剩余具体修复

决策：無涘（明确要求直接修复，而不是继续只诊断；协助打开失败视频号实测） ｜ 记录：Codex
session 01a09a8f-210e-79d0-93d2-85ee0836e9c7

- 实施候选修复：单行标题/书本图标作者行合并，输入底部排除Send；标题不混作者footer。使用真实Gwen/Nicky OCR和单行长间隔反例回归。
- UI历史时间解析增加notAfterReference选项，保持通用日期解析默认API不变；bare21:06在9/14凌晨归9/13。前置时间不再受180px距离限制；看到下一时间组而缺前置时间的顶部卡片暂缓，下一页看到16:09则在点击前排除。保留无可见上下文时旧占位，不伪称所有消息时间精确。
- 单次URL集合防重复，不再因visible_timestamp/fallback产生两个记录；视频URL可从疑似图片转回链路确认并最终计入video_channel。
- 修复视频UI三个实际问题：分享坐标必须用右半阅读区；捕获目标必须保持同一viewer，不能混用Photos rect和主窗OCR；截图会移开鼠标，Copy Link前需激活/清空剪贴板/恢复悬停后再点击。视频剪贴板等待增加到2s。保护截图清理Esc不把viewer或分享popup误关。
- 本场用户承认切换过桌面导致一次验证被干扰；保持微信前台后手动最小hover/copy得到真实/sph/，再将同样顺序接回extractShareCardUrl，最终生产提链函数实测status=ok，证据video-link-final-v3.json。没有用手工copy成功冒充管线成功。
- 新增本机Swift图像匹配（复用既有Swift编译缓存，无npm依赖）识别圆形×；参考图只截按钮36×36，拥挤标签fixture只保留公开文章标签栏。原失败画面定位到(2082,56)像素，正确区别于固定905pt。用标题栏像素fingerprint防止相同标题被误判无变化，保留失败截图。
- 实际Nicky提链成功，URL为https://mp.weixin.qq.com/s/tAxkvBggHtkDzpezCIOMLw；随后的session.finish实际关闭2个标签，status=closed，主窗口保留。清理前AX短时空列表增加有限等待。
- 原失败15页OCR离线回放在第14页/9月13日16:09停下，Nicky与Gwen都进入候选，Send/16:09/购买记录无点击。回放extract返回offline_click_not_executed，报告明确offline，不写真实索引。
- 全量222/222测试，/tmp/clippings-release-repaired-tests.log；最后去除无用固定关闭坐标校准后的定向20/20通过。主要证据在local/repair-2026-0914/，失败尝试也保留。
- 本轮未重新在线采集全部19篇、未启动视频下载/ASR/模型摘要、未写PKM；后续处理实现保留原链路。只同步本次相关代码、测试与项目记录，不纳入其他历史/WIP改动。

原始对话：dialogues/2026-0913.md「1938 （未分类）」
