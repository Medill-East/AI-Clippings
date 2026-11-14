# ProjectProgress

*更新于 2026-11-14T16:16:11+08:00 · 记录者 Codex*

## 2026-11-14 单条视频号（1/1 已剪藏）

- 《原创是否真的存在？真正的创造力是解释力》已入库。来源为阅读兽 ReadingCub 转发的 Lofi Cinema 视频。按 10 分 34 秒英文语音的本机转写整理，含 6 条要点与原片入口。
- 笔记来源唯一，回读已核验。运行与核对证据在本机 `obsidian-web-clipper-ingest/local/intake/2026-1114/video-Aoh4G15NXd/`。

## 2026-11-14 新链接批次（8/8 已剪藏）

- 文字中有 6 个不同链接，Logo 文章重复一次。两条视频、四篇公众号和截图中的两条官网链接各对应一份 Obsidian 笔记。
- 本轮使用原 Web Clipper 脚本自行启动 Chrome。四篇公众号均在第一轮保存，全程未触发微信验证。Logo Skill、《千高原》讲稿、《游点现实》和 Harness-of-Harness 报道已回读来源、正文、摘要和要点。完成核对见本机 `obsidian-web-clipper-ingest/local/intake/2026-1114/complete-verification.json`。
- 两条视频曾分别按原片画面、作者发布的讲稿与 B 站章节整理。截图中的帝国理工 DEPS 和 LISS DTP 已剪藏官网。DEPS 1 月 11 日截止，3 个名额中 2 个面向海外学费类别；入学日期有冲突。LISS 接受国际生，海外学费差额不保证补齐。
- 之前的 Codex 浏览器读取标签页排查不属于原剪藏流程。原脚本已增加可选的验证等待模式，保留当前 Chrome 标签供本人操作，再继续剪藏。自动测试已通过。本批没有触发实际验证。
- 本批旧 PWE 正文请求已随四篇入库撤回。原始运行、补录和复核证据皆保留。

## 2026-11-09 新链接批次（40/42 已剪藏，2 篇待验证）

- 11 月 14 日用独立 Chrome 和原 Web Clipper 补齐四篇公众号。两轮沿用本机 10 并发上限。DeepSeek 和游戏镜头在两张微信验证标签等待时完成；《四位思想家》和 Meta 设计系统在修正扩展初始化后并行保存。全批 38 篇文章和 2 条视频，各来源唯一，原文和摘要均已回读。
- Karpathy 和《一条言简意赅的 AI 设计准则》弹出微信验证。本人多次尝试未通过，已停止这两篇的自动重试。没有证据确认微信更改了访问频次规则或文章已删除。待办和各次运行结果见本机 `obsidian-web-clipper-ingest/local/intake/2026-1109/` 的 `pending-links.txt` 与 `final-verification.json`。
- Web Clipper 起步时等扩展绑定并核对当前文章来源，摘要继续并行。单篇微信验证等待期间，其他文章可正常处理。已安装技能指向本项目的脚本和配置。现场验证通过后的完整交接仍待确认。
- 11 月 9 日首批完成 34 个来源。11 月 12 日另用作者或授权版补齐两个来源。历史状态与原导入版本保留在本机。

## 2026-10-31 新链接批次（14/14 完成）

- 用户提供 14 个唯一链接：11 篇公众号文章、3 个视频号；处理前扫描 1534 份剪藏，无对应源链接重复。
- 10 篇文章经现有 Chrome / Web Clipper 单并发剪藏，逐份核对标题、源链接、摘要/要点与正文；移除 10 份笔记末尾的扩展 iframe，原始保存版本留在本机 intake 的 notes-before-finalize/。
- 第9篇《卡比之父：真正的原创游戏只能由人类创造》原入口、标准入口及备用读取均落到微信验证页，没有把验证页保存为正文。用户随后粘贴全文；按提供内容原样补录，正文与实际 transcript 用户消息逐字一致，补齐 AI Summary / Key Facts。明确标注用户提供正文、网页未独立核对；署名和发布日期未知，文件名用收录日期。
- 视频3/3完成解析、本地 ASR、摘要与保存。回读发现手写笔、肖像印两条原摘要主要总结背景歌曲，已各抽10张画面并人工视觉检查/OCR后修正，保留修前全文、修后哈希和原因；宫本茂视频使用日语语音转写。临时媒体和逐字稿按原流程清理。
- 最终14个源链接各对应1份笔记，源链接、摘要/要点、文章正文及SHA-256全部通过；1548份剪藏中无本批重复。笔记位于 PKM/PlayWithExperiences/Clippings/WeChat/2026/。
- 主文章manifest：obsidian-web-clipper-ingest/local/runs/2026-10-31T05-31-33-093Z/manifest.json（网页10成功、1被验证拦截）；标准入口重试：05-35-40-874Z。视频manifest：wechat-filehelper-macos-ingest/local/video-channel/runs/2026-10-31T05-31-34-046Z/manifest.json。最终验收以 local/intake/2026-1031/final-verification.json 为准，用户补录不改写历史失败状态。
- 本批只使用既有管线及本机临时核验脚本，没有修改管线源码；未把既有其他会话未提交改动纳入备份。

## 2026-10-25 新链接批次（已完成）

- 用户粘贴的 11 个链接全部完成：10 篇公众号文章、1 个 GitHub 仓库；处理前扫描 1523 份既有剪藏，未发现对应源链接的重复笔记。
- Chrome / Obsidian Web Clipper 单并发处理，一轮 11/11 保存；manifest：obsidian-web-clipper-ingest/local/runs/2026-10-25T12-35-59-393Z/manifest.json。
- 回读发现 GitHub 模板未提取 README。已从官方 GitHub API 取回完整源文件，核对 Git blob 3d46f04cebc27a6acc03b49086ff91a206221a3d，补齐正文、中文摘要与要点，将相对资源链接转绝对链接。
- 9 份公众号笔记末尾混入扩展自己的 iframe 标签，已移除；原始保存版本留在该批 local/intake 的 notes-before-finalize/。
- 最终逐项核对源链接、标题、非空摘要/要点、正文及 SHA-256；GitHub 正文与仅调整资源链接后的完整源文件逐字一致。入库后复查 11 个源链接各对应 1 份笔记，无失败或重复。
- 笔记位于 PKM/PlayWithExperiences/Clippings/WeChat/2026 与 Clippings/GitHub/Repositories；详细核验：obsidian-web-clipper-ingest/local/intake/2026-1025/article-verification.json，重复复核：dedup-after.json。local/ 为忽略的本机证据。
- 本批没有修改管线源码；仅使用既有配置与已存在的摘要服务，没有安装文章推荐的项目或技能。

## 2026-10-18 新链接批次

- 用户已明确确认 40 篇文章与 5 个视频号的整批范围及费用未知边界。
- 文章 40/40 最终通过源链接、笔记存在、非空摘要与正文回读；核验清单：obsidian-web-clipper-ingest/local/intake/2026-1018/article-verification.json。
- 首批并发 4 时有 2 条扩展来源串位，暂停后改串行补齐；另有 1 条验证码页被末检识别，隔离并重试取得正文。3 份错误产物保留在同目录 quarantine/。
- 补入保存前源链接校验、保存后源链接回读、验证码页拦截；20 项测试通过。2 个缺失/无法确认的发布日期文件名使用收录日期，原始日期文字保留。
- 视频已补齐 5/5：根因为会话过期，元宝自身 /api/getuserinfo 同样 401；旧登录检查把缓存昵称/登录按钮尚未渲染误判成功。用户重新扫码后解析恢复。登录命令改用账户接口响应验证，凭据变化时重新验证；提前关闭窗口明确报尚未验证。
- 视频首轮 3 个完成、2 个媒体网络失败；仅对两项串行恢复后均完成。总计 5 个唯一视频、5 次摘要；本机 ASR 串行，临时媒体和逐字稿已清理，5 份笔记逐项回读通过。
- 视频核验：obsidian-web-clipper-ingest/local/intake/2026-1018/video-verification.json；成功产物来自视频 manifests 2026-10-18T06-20-48-174Z（3）与 06-29-08-537Z（2）。解析、批次、管线、运行时共 40 项回归检查通过。
- 文章 manifests：06-00-07-690Z（首批中断）、06-07-30-799Z（21/21）、06-16-03-117Z（1/1）；均在 2026-10-18 的 local/runs 下。最终核验清单优先于首批旧 success 标记。
- 视频阻塞 manifest：wechat-filehelper-macos-ingest/local/video-channel/runs/2026-10-18T06-01-41-291Z/manifest.json。

## 当前后台收件验证状态

- 2026-10-18：用户扫码确认官方 ClawBot/iLink 绑定。本机以腾讯公开协议编写只收件诊断客户端，未安装完整 OpenClaw，未调用模型或发送回复。
- 实际收到 6 条：测试文字、公众号标题+mp.weixin.qq.com 链接、视频号描述+/sph/ 链接、普通文字、网页链接、合并转发 ZIP。用户确认手机会话也显示链接。
- 离线提链输出 2 个网页/公众号链接、1 个视频号短链、1 个未展开 ZIP；这证明逐条转发可替代前台点开/复制环节。合并转发仅验证附件到达，不宣称内部链接可直接解析。
- 新入口：wechat-filehelper-macos-ingest/scripts/probe-clawbot.py 与 export-clawbot-links.js；使用说明 references/clawbot-probe.md。忽略目录 local/clawbot-probe/ 保存私有状态与提链结果，凭据未入 Git。
- 收件测试已停止，未配置常驻；未运行后续正文、视频解析、ASR、摘要与 PKM 写入。旧 UI 采集器未修复，当前优先后台方案。
- GitHub #198 原页显示10月14日已关闭，旧搜索摘要过时；第三方 fav 曾实现两种通道后撤回，不能作为当前官方通道不可用的证据。

## 上轮已完成采集

- 本轮已确认链接处理完成：14 篇公众号文章，以及 12 个视频号分享短链去重后的 7 个唯一视频。
- 文章 14/14 已剪藏；每条请求 URL 与剪藏目标一致，笔记存在且包含对应源链接。
- 视频 7/7 均完成本地 ASR、摘要与 PKM 写入；视频媒体和逐字稿按默认流程清理。
- 合并清单含 21 个唯一源链接，保存在视频采集仓库被 Git 忽略的 local/exports/。

## 已完成验证

- 文章 manifest：obsidian-web-clipper-ingest/local/runs/2026-09-19T10-22-02-040Z/manifest.json；14 个目标均通过回读。
- 视频源 manifest：wechat-filehelper-macos-ingest/local/video-channel/runs/2026-09-19T03-52-37-185Z/manifest.json；12 个分享短链对应 7 个唯一视频。
- 七个成功重处理 manifest 位于 wechat-filehelper-macos-ingest/local/video-channel/runs/ 下，时间分别为 10-27-10-900Z、10-59-52-593Z、11-03-26-071Z、11-05-31-927Z、11-07-44-196Z、11-10-58-934Z、11-14-38-295Z；均为 complete 且各写入 1 条。
- 合并清单：wechat-filehelper-macos-ingest/local/exports/2026-0919-merged-wechat-links.md；纯链接文件：同目录 2026-0919-merged-wechat-links.txt。
- 一次中断任务留下 27/36 个已完成分片；后续以同一 task ID 恢复并完成。10:30 的旧 manifest 仍显示 running，是历史记录状态，不代表有进程运行。

## 性能观察与限制

- 视频任务串行；每次只有一个 ASR 分片 worker。V2T auto 在本机 10 个逻辑 CPU 上解析为 5 个 Sherpa 线程。单 worker 曾出现约 97%–181% CPU，可能加重卡顿，但不是并行 ASR。
- 完成后未发现 ASR worker。采样时 WindowServer 与 Codex 图形进程占用较高；内存空闲约 64%、swap 为 0。这些时间点快照不足以单独判定卡顿根因。
- 为降低前台影响，后五个视频使用 nice 19。输入之外的 unresolved 卡片未扩展处理，也没有重新扫描微信。

## 下一步

- 下一批继续使用独立 Chrome 与 Web Clipper，采用现有并发设置。遇微信验证按提示交接。11 月 9 日仍有两篇待正文。

## 阻塞 / 待定

- 后台长期运行与重连/离线补收尚未验证；合并转发 ZIP 未展开。旧 UI 流程仍未修复。
