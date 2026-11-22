# ProjectProgress

*更新于 2026-11-22T22:50:00+08:00 · 记录者 DSH 子会话 agent-1*

## 2026-11-22 微信转来 46 条链接（38/44 已入库，5 篇待验证，1 条需登录）

- 清单 46 条：42 个文章或网页链接、2 个视频号短链、2 条只有标题没有链接的视频。已入库 38 条：33 篇公众号、1 个 GitHub 仓库、2 个普通网页、2 条视频号。
- 5 篇公众号打开后跳到微信「环境异常」验证页。原链接与标准入口各试一次都未取得正文，按既有规则标为待补，未把验证页保存成文章：第 3、16、17、29、36 条。
- 第 4 条小红书落到账号异常页（错误码 300011）。扩展曾把该页存成「安全限制」笔记，已隔离到本机 `quarantine/`，未计入成功。第 12、42 条只有标题，没有链接。
- 文章首轮 manifest：`obsidian-web-clipper-ingest/local/runs/2026-11-22T14-17-07-755Z/manifest.json`（37 成功、5 拦截）；标准入口重试：`2026-11-22T14-29-52-226Z/manifest.json`（0/5）。
- 视频 manifest：`wechat-filehelper-macos-ingest/local/video-channel/runs/2026-11-22T14-31-05-590Z/manifest.json`（70 秒，6 条要点）与 `2026-11-22T14-32-19-016Z/manifest.json`（1250 秒，8 条要点）。临时媒体与逐字稿已清理。
- 33 篇公众号末尾由扩展写入的 side-panel iframe 已移除，改前版本留在本机同批 `notes-before-finalize/`。两条普通网页移到 `Web/2026`，补站点名并按收录日期改名。
- GitHub 仓库剪藏改用官方 API 原文替换正文，核对 Git blob `ae799016240e49c70ec988062d919227a236c5fd`，相对链接转绝对链接。
- 逐条状态、源链接、笔记路径与 SHA-256 见本机 `obsidian-web-clipper-ingest/local/intake/2026-1122/final-verification.json`；待补清单见同目录 `pending-links.txt`；复查 1640 份剪藏，38 个源链接各 1 份笔记、无重复（`dedup-after.json`）。
- 笔记已提交并推送 PKM 私有远端，提交 `0324988a`。

## 2026-11-14 单条视频号（1/1 已剪藏）

- 《原创是否真的存在？真正的创造力是解释力》已入库。来源为阅读兽 ReadingCub 转发的 Lofi Cinema 视频。按 10 分 34 秒英文语音的本机转写整理，含 6 条要点与原片入口。
- 笔记来源唯一，回读已核验。运行与核对证据在本机 `obsidian-web-clipper-ingest/local/intake/2026-1114/video-Aoh4G15NXd/`。

## 2026-11-14 新链接批次（8/8 已剪藏）

- 文字中有 6 个不同链接，Logo 文章重复一次。两条视频、四篇公众号和截图中的两条官网链接各对应一份 Obsidian 笔记。
- 本轮使用原 Web Clipper 脚本自行启动 Chrome。四篇公众号均在第一轮保存，全程未触发微信验证。完成核对见本机 `obsidian-web-clipper-ingest/local/intake/2026-1114/complete-verification.json`。

## 2026-11-09 新链接批次（40/42 已剪藏，2 篇待验证）

- 全批 38 篇文章和 2 条视频，各来源唯一。Karpathy 和《一条言简意赅的 AI 设计准则》弹出微信验证，本人多次尝试未通过，已停止自动重试。
- 待办与各次运行结果见本机 `obsidian-web-clipper-ingest/local/intake/2026-1109/` 的 `pending-links.txt` 与 `final-verification.json`。

## 当前后台收件验证状态

- 2026-10-18：用户扫码确认官方 ClawBot/iLink 绑定。本机以腾讯公开协议编写只收件诊断客户端，未安装完整 OpenClaw，未调用模型或发送回复。
- 实际收到 6 条：测试文字、公众号标题+mp.weixin.qq.com 链接、视频号描述+/sph/ 链接、普通文字、网页链接、合并转发 ZIP。
- 收件测试已停止，未配置常驻；旧 UI 采集器未修复，当前优先后台方案。

## 下一步

- 本人在场时用 `OBSIDIAN_CLIPPER_WECHAT_HANDOFF=1` 对第 3、16、17、29、36 条各跑一次原脚本，验证后自动继续剪藏。
- 第 4 条小红书可在登录后重新剪藏，或直接提供正文补录。

## 阻塞 / 待定

- 微信验证只能由本人完成；无人值守运行会按规则把该条标为待补。
- 后台长期运行与重连/离线补收尚未验证；合并转发 ZIP 未展开。
