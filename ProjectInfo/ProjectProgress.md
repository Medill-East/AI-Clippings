# ProjectProgress

*更新于 2026-11-28T12:48:47+08:00 · 记录者 Codex*

## 2026-11-28 微信文章剪藏（26/26）

- 26 条链接首轮写入 Obsidian 的 Clippings/WeChat/2026。本批待补 0 条。
- 逐篇核对源链接、标题、正文、摘要和要点。复查 1667 份剪藏，本批每条来源对应一份笔记。
- 清除 26 篇笔记内的扩展界面残片。清单、运行记录与清理前版本见本机 \`obsidian-web-clipper-ingest/local/intake/2026-1128/\` 及[会话摘要](sessions/2026-1128-pasted-link-batch.md)。
- 修复失效的本机 Chrome 路径。安装的技能入口和本次运行都使用规范目录。
- 笔记备份至 PKM 私有远端，核对提交 \`17e491bd\`。

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
- 本批在旧副本 `/Users/haodong/Documents/AI/Codex/Clippings` 运行：已安装的 Web Clipper 技能符号链接仍指向它，运行证据也在该副本的 `local/` 下。

## 2026-11-14 单条视频号（1/1 已剪藏）

- 《原创是否真的存在？真正的创造力是解释力》已入库。来源为阅读兽 ReadingCub 转发的 Lofi Cinema 视频。按 10 分 34 秒英文语音的本机转写整理，含 6 条要点与原片入口。
- 笔记来源唯一，回读已核验。运行与核对证据在本机 `obsidian-web-clipper-ingest/local/intake/2026-1114/video-Aoh4G15NXd/`。

## 2026-11-14 新链接批次（8/8 已剪藏）

- 文字中有 6 个不同链接，Logo 文章重复一次。两条视频、四篇公众号和截图中的两条官网链接各对应一份 Obsidian 笔记。
- 本轮使用原 Web Clipper 脚本自行启动 Chrome。四篇公众号均在第一轮保存，全程未触发微信验证。完成核对见本机 `obsidian-web-clipper-ingest/local/intake/2026-1114/complete-verification.json`。

## 2026-11-09 新链接批次（40/42 已剪藏，2 篇待验证）

- 全批 38 篇文章和 2 条视频，各来源唯一。Karpathy 和《一条言简意赅的 AI 设计准则》弹出微信验证，本人多次尝试未通过，已停止自动重试。
- 待办与各次运行结果见本机 `obsidian-web-clipper-ingest/local/intake/2026-1109/` 的 `pending-links.txt` 与 `final-verification.json`。

## 仓库副本合并（2026-11-15，仍在处理）

更新于 2026-11-15 01:44:46 +0800 · 记录者 Codex

- 规范目录为 `/Users/haodong/Documents/GitHub/AI-Clippings`。已从旧副本快进补入 24 个主线提交（bb8b35d → dfea094），导入其 21 项未提交改动及 19 个新增资料/测试文件。
- 已核验 3,686 项有价值的旧副本文件在本仓内容一致或有保留的差异版本。2,829 项新运行数据补入原 local/；569 项同名运行数据保留当前版本，旧版放根目录 `.duplicate-merge-20261115/codex/`（本机忽略，不提交）。另保留旧 trace-pending 索引副本。共复制/保全约 403 MB。
- 本仓原未提交内容已命名 stash 备份并恢复；原 HEAD 有 backup/pre-duplicate-merge-20261115。旧副本两项 stash、main 及独有命名迁移分支均已保存在本仓 backup/codex-20261115/*。独有分支的 22 个提交保持独立，不宣称已启用其中功能。
- 本仓原有 14,069 个忽略文件逐项核验未变；旧副本 4,426 个枚举文件及 HEAD/分支/stash/remote/status 均核验未变。旧工作树干净；依赖可重建。旧目录未删除、未移动；临时 remote 已移除，origin 未改，未 push。
- Web Clipper 21 项、微信采集 226 项测试通过；本次未运行在线剪藏或重新核验历史文章完成状态。

## 仍需处理

- 旧目录暂保留。2026-11-28 核对，已安装技能和 Director 项目名册均指向规范目录。Director 的 board-state.json 仍有旧目录引用。
- 历史命名迁移分支如需启用，另行与现主线整合并验收；其完整历史已在本仓保存。
- 采集业务状态沿用合并前快照，未当作本轮重新验证：见 evidence/2026-1115-merge-duplicate-copy/merge-base-ProjectProgress.md。原记录指出 11/9 批次 40/42，2 篇微信验证待处理。

## 证据入口

- 本场摘要：sessions/2026-1122-pasted-link-batch.md、sessions/2026-1115-merge-duplicate-copy.md
- 比对、逐项价值判断、恢复入口：evidence/2026-1115-merge-duplicate-copy/README.md
- 旧路径完整引用：evidence/2026-1115-merge-duplicate-copy/old-path-references.md
- 未提交的系统 .DS_Store 留在原地；本机运行数据与 stash/备份分支也不在本次 main 提交的数据范围内。

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
