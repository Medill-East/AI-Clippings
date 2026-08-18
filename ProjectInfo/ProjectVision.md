# Clippings（草稿）

> ⚠️ 本文件为 AI 草稿：内容从该项目历史会话中**原文摘录**，未经無涘加工与确认，不代表已定愿景。無涘确认后请删除本横幅，并按模板分节填写（模板见 Director/templates/ProjectVision.md）。
> 提取于 2026-08-18 · 记录者 dsh（DeepSeek Harness）

- 它要解决微信文章卡片无法直接批量导出、时间戳不稳定、viewer 加载和菜单点击容易失败的问题。项目同时扩展视频号处理，避免视频内容因为拿不到稳定 URL 而被静默跳过。

- 这是一个 macOS 微信「文件传输助手」内容采集工具，优先通过 UI/OCR 识别卡片并把文章链接、视频号内容写入本地索引和 Obsidian 流程。

## 目标与验收
- （待無涘确认）

- 不保存完整视频文件，不依赖视频号稳定 URL，也不把视频号强行纳入文章 viewer 提链逻辑。当前不处理 Bilibili 视频卡片和普通视频链接的完整内容，也不替代另一个 AI 对文章链接进行摘要。

## 项目参考
- （可删本节）

## 开场交代（原文摘录，AI 未加工）

> 来源：codex 会话 019d37d9-9090-7753-b554-6ad485b7ced9（2026-03-29 12:28，cwd /Users/haodong/Documents/AI/Codex/Clippings）
>
> 你先学习一下这个仓库里面的几个 filehelper 的内容
> 其中一个是给 Windows 用的，一个是尝试做的 Web 版，一个是做的 iOS 版本。
>
> 整体来说，我现在想做的是 iOS 桌面端的，但是它当前的版本不能用的，因为它采用了简洁版的这个思路。但是这个是没有办法正确获取到内容的。
>
> 所以最终我所需要达到的目标是，我希望能够自动帮我获取一段时间内的微信文件传输助手内的链接，可以跳过不好获取的视频号或者 B 站等的链接。

> 来源：codex 会话 019d4493-d0e8-7a43-8d99-38b8ce64d857（2026-03-31 23:47，cwd /Users/haodong/Documents/AI/Codex/Clippings）
>
> 我需要你看一下仓库里的 obsidian web clipper 这个 skill 并且利用该 skill 处理下面这些链接
> https://github.com/Medill-East/AI-Clippings
>
> - [天美蒙特利尔关停调查：大厂 3A野心为何难落地](https://mp.weixin.qq.com/s/NJd_p2EZrM01kMtsA7_Elg)
>   > 2026-03-31T01:23:00.000Z
> - [Claude 深夜长出「双手」， 接管电脑狂飙代码！额度光⋯.](https://mp.weixin.qq.com/s/w3dvnGs_1D3MaH3uHiCOUA)
>   > 2026-03-31T01:50:00.000Z
> - [如何在AI时代，找回你被埋没 的创造力。](https://mp.weixin.qq.com/s/9ejYjBP-hmmz6lliDbROjg)
>   > 2026-03-31T04:26:00.000Z
> - [分享6个我觉得应该必装的 Skills。](https://mp.weixin.qq.com/s/udSpp7eMqwiRo5yVShRzLw)
>   > 2026-03-30T02:20:00.000Z
> - [https://h5-pay.xywlhlh.com/pages/index/index?xid=2MHnK](https://h5-pay.xywlhlh.com/pages/index/index?xid=2MHnK)
>   > 2026-03-29T11:41:00.000Z
> - [深度|对话OpenAI Codex负 责人：IDE 已死，产品经理⋯.](https://mp.weixin.qq.com/s/l6jA0G5NOERyNk3YfGD50Q)
>   > 2026-03-29T17:34:00.000Z
> - [刚刚，飞书CLI开源， Claude](https://mp.weixin.qq.com/s/fvjxT_GgbEgxgsPCUlo-RQ)
>   > 2026-03-28T10:05:00.000Z
> - [https://www.youtube.com/watch?v=ea81dJjF5ts](https://www.youtube.com/watch?v=ea81dJjF5ts)
>   > 2026-03-29T11:31:00.000Z
> - [https://www.youtube.com/watch?v=%E2%82%ACa81dJjF5ts](https://www.youtube.com/watch?v=%E2%82%ACa81dJjF5ts)
>   > 2026-03-29T11:31:00.000Z
> - [不是人 效 数字生命卡兹克](https://mp.weixin.qq.com/s/Trc0nbnE_faVTbG1IjDX3w)
>   > 2026-03-31T15:59:59.000Z
> - [安利一个11万Star的必装插 件，能让你的Agent体验直⋯.](https://mp.weixin.qq.com/s/06zQ7izFKN7oZnzVaNwkdw)
>   > 2026-03-31T15:59:59.000Z
> - [全链路AIPPT 神器：牛马打工 人有救了](https://mp.weixin.qq.com/s/LHImQ1_HtdOtqQxhUlClZw)
>   > 2026-03-31T15:59:59.000Z
> - [的神 那么三年
> …（截断，全文见来源会话）

> 来源：codex 会话 019e5902-a5f3-7d42-9fa8-ab9818829438（2026-05-24 16:03，cwd /Users/haodong/Documents/AI/Codex/Clippings）
>
> wechat-filehelper-macos-ingest
>
> 前面的对话卡住了，我重开了一个，你先理解一下这个项目


## AI 访谈原文（codex）

> 访谈：codex（2026-08-18 00:20）｜ 整理：dsh ｜ 待無涘确认

1. 这是一个 macOS 微信「文件传输助手」内容采集工具，优先通过 UI/OCR 识别卡片并把文章链接、视频号内容写入本地索引和 Obsidian 流程。

2. 它要解决微信文章卡片无法直接批量导出、时间戳不稳定、viewer 加载和菜单点击容易失败的问题。项目同时扩展视频号处理，避免视频内容因为拿不到稳定 URL 而被静默跳过。

3. 文章链路已基本稳定，支持 UI 扫描、OCR 兜底、viewer 菜单复制、外部链接识别、去重和失败诊断。视频号已接入独立 pending 队列、本地音频捕获、V2T ASR、摘要和 Obsidian 写回；`collect` 会先输出文章链接，再确认是否继续处理视频。尚未完成自动播放/自动判断结束、统一入口的视频真实场景验证，以及 Bilibili 和其他视频链接的处理。

4. 不保存完整视频文件，不依赖视频号稳定 URL，也不把视频号强行纳入文章 viewer 提链逻辑。当前不处理 Bilibili 视频卡片和普通视频链接的完整内容，也不替代另一个 AI 对文章链接进行摘要。

5. 视频处理依赖 macOS 屏幕录制权限、微信播放状态、目标屏幕音频、`ffmpeg`、本地 V2T 模型和 Obsidian/本地摘要服务，人工操作时可能捕获不到正确内容。视频号链接和媒体地址仍不稳定，当前主要依靠卡片指纹和用户手动播放；文章链路暂无明确代码阻塞。

