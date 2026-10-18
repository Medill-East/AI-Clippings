# 会话摘要

## 2026-10-18 13:04 新版微信窗口诊断：桌面点击通道阻塞

记录：Codex（在场摘要）｜ session 01a14d62-d4f4-7222-8545-901935dd29b8
trace-user-count: 1
trace-source-sha256: 52c74a4ec90ffef86171b86e64c068df7152efbb6b9b116165e5e752c144e955

结论：本工作段仅完成诊断，尚未修复。当前 CUA 微信截图显示只有 File Transfer 聊天，无右侧文章阅读栏；AX 树只暴露窗口和菜单。两次 CUA 坐标点击均返回 AXError.notImplemented，未产生可见变化。已向用户请求允许使用项目已有 AppleScript/鼠标自动化做单篇打开、复制链接、关闭验证，尚未收到答复。

证据：wechat-filehelper-macos-ingest/local/ui-layout.json 仍为 docked_articles、1470×923、chatWidth=735；scripts/lib/docked-articles.js current() 严格检查尺寸，probe() 要求文章栏已打开；scan.js 强制该预检，不会在失败后自动退回普通模式。diagnose-filehelper.js 则未使用 docked 预检，因此诊断与实际 scan 存在检查范围差异。截图没有提供逻辑窗口尺寸，不把像素尺寸视为已核实逻辑尺寸。

风险：尚未观察到新版文章打开后的真实控件，不足以确认菜单位置或关闭按钮是否改变。未执行批量采集、摘要、外部模型调用或索引重建。工作区原有其他修改保持不动；GitHub 目录副本与当前 docked-articles.js 相同，但未修改另一目录。

下一步：获得替代 UI 控制授权后，用现有脚本做单篇复现，按实际窗口结构修复最小点击路径并完成真实链接与聊天恢复验证。当前没有代码变更，不能称流程已恢复。

原始对话：/Users/haodong/.codex/sessions/2026/10/18/rollout-2026-10-18T13-01-25-01a14d62-d4f4-7222-8545-901935dd29b8.jsonl
<!-- trace-finalize 5aef878331e2ade399cbf68cfb0920fe4efca43ce03d3ba213963e854c4e96e0 -->

## 2026-10-18 13:47 单篇验证与不占前台的后台收件方案调查

记录：Codex（在场摘要）｜ session 01a14d62-d4f4-7222-8545-901935dd29b8
trace-user-count: 4
trace-source-sha256: 9839c2c79ea172430916d00f260e18aa3395803674602b7e822e53982fe414f7

结论：用户授权现有 AppleScript/鼠标脚本单篇验证后，确认主聊天窗口735×923，文章进入独立 WeChat (Window) 920×823，多标签菜单位于标签内而非旧右上角。中途出现手机登录确认，用户已确认并恢复。旧截图函数触发截图/取色浮层；一次 Escape 未消除，点击浮层取消后文章正文可直接截图。Copy Link 单次尝试剪贴板为空，不算成功；文章窗口随后关闭、聊天窗口仍在。无代码修复或整批采集完成。

用户随后将本场优先事项转为公开调查不占微信前台的替代工作流，旧点击路径修复暂停。按 agent-reach 做有限公开检索，未安装、绑定机器人或调用付费模型。

证据与来源：
- https://github.com/Tencent/openclaw-weixin ：腾讯仓库，二维码授权、长轮询、文字/图片/语音/文件/视频。https://github.com/Tencent/openclaw-weixin/blob/main/docs/protocol.md 提供 getUpdates 的 HTTP/JSON 协议。
- https://github.com/Tencent/openclaw-weixin/blob/main/src/api/types.ts 当前 MessageItemType 是 TEXT/IMAGE/VOICE/FILE/VIDEO 及工具调用状态，未列公众号卡片/视频号分享/合并转发结构。这仅证明公开客户端类型范围，不能证明服务端绝对不支持或不会转成文字。需真实样本接收测试。
- https://github.com/RongleCat/hermes-wechat ：第三方 Hermes 接入示例，表明可以使用同一通道接其他 Agent；其 README 不是腾讯服务端能力保证。
- https://github.com/CJackHwang/wx-filehelper-api ：文件助手网页协议后台接口，SQLite 与 getUpdates/webhook。读了 https://raw.githubusercontent.com/CJackHwang/wx-filehelper-api/main/direct_bot.py （临时保存 /tmp/wx-filehelper-direct-bot.py），_normalize_messages 只输出 MsgType=1、3、49且AppMsgType=6；其他类型仍记 seen/raw，但不加入返回列表。不能开箱替代公众号/视频号/合并聊天收件。
- https://github.com/lich0821/WeChatFerry 搜索结果显示2026-07-10归档；Hook路线可接收/查询消息，但本场未进行版本兼容和部署验证，不推荐为Mac工作流引入额外非官方客户端维护。

风险：公开类型与README无法保证服务端透传卡片；实机迁移验证尚未进行。

下一步（AI提案，非用户决定）：优先试官方 ClawBot 作为主动投递的后台收件箱，接本地持久队列，再复用现有分类/去重/文章与视频管线。先测试纯链接、公众号卡片、视频号分享、合并转发四类样本的原始payload，接收阶段无需模型。卡片若不透传，纯链接收件仍可作为部分替代。接收成功不等于文章正文或视频提取成功，不把机器人通道描述成整个微信历史读取API。价格未核查、不称整套免费。没有新迁移或批量调用授权。

原始对话：/Users/haodong/.codex/sessions/2026/10/18/rollout-2026-10-18T13-01-25-01a14d62-d4f4-7222-8545-901935dd29b8.jsonl
<!-- trace-finalize 6ff4408376ec514fea121cf7d321411eec7062f2c3a42258ff43cff1794d997e -->
