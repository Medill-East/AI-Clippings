# ProjectProgress

*更新于 2026-10-18 · 记录者 Codex*

## 2026-10-18 新链接批次

- 用户已明确确认 40 篇文章与 5 个视频号的整批范围及费用未知边界。
- 文章 40/40 最终通过源链接、笔记存在、非空摘要与正文回读；核验清单：obsidian-web-clipper-ingest/local/intake/2026-1018/article-verification.json。
- 首批并发 4 时有 2 条扩展来源串位，暂停后改串行补齐；另有 1 条验证码页被末检识别，隔离并重试取得正文。3 份错误产物保留在同目录 quarantine/。
- 补入保存前源链接校验、保存后源链接回读、验证码页拦截；20 项测试通过。2 个缺失/无法确认的发布日期文件名使用收录日期，原始日期文字保留。
- 视频首条解析 HTTP 401，另 4 条未尝试；登录辅助程序误报正常，恢复后接口仍 401。视频 0/5，未下载/ASR/摘要；保留待处理，不继续自动重试。
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

- 本轮确认范围内无剩余项；后续按文章与视频类型分别核对 manifest 和 PKM 笔记。

## 阻塞 / 待定

- 后台长期运行与重连/离线补收尚未验证；合并转发 ZIP 未展开。旧 UI 流程仍未修复。
