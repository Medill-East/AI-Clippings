# wechat-video-channel-processing

> 按主题一份，追加不覆盖；同一场会话的节就地更新。


## 1315 打通视频号全自动处理并修复漏采

决策：無涘 ｜ 记录：codex（自动）｜ session 01a027da-4e12-76c3-a39e-34d494386966

本次会话完成视频号链路从「跳过」到「全自动处理」的打通，并修复了批处理中第二条视频漏采的问题。

关键产出：
1. 根因确认：视频号此前被 `video_channel` 规则在采集层直接跳过，从未进入处理链路；8月18日项目快照错误记录了尚未实现的能力。
2. 处理链路打通：复用 V2T 本地模型（FunASR Nano/Qwen3-ASR/SenseVoice）实现下载→转写→摘要→Obsidian 写回的后台链路；用户直接提供第二条链接后成功处理并写回 PKM。
3. 架构决策：采集层统一从 File Transfer 提取链接（文章与视频号），处理层按 URL 类型分流——文章继续用 Obsidian Web Clipper，视频走后台转写链路；两个 Skill 经过官方校验器验证。
4. 窗口选择修复：定位并修复截图蒙层窗口被误选为聊天主窗导致负坐标的 bug；`getFrontWeChatWindow()` 新增主窗选择器，三处聊天截图路径已替换。
5. 显式 URL 处理修复：`--url` 参数在索引未命中时不再返回空成功，改为直接创建 `source=explicit_url` 任务。

测试状态：视频模块全套 128/128 通过；本次实机验证两条视频号均成功写回 PKM。

风险：AudioTee 按 PID 抓音频 API 不稳定，目标进程未出声时可能失败导致丢字；当前转写链路依赖用户提供的链接或已入索引的链接，未测试纯自动发现+播放的全闭环。

原始对话：dialogues/2026-0822.md
## 1734 第二条视频写回与统一分流契约完成

决策：無涘（统一采集链接；文章复用 Obsidian Web Clipper；视频取得 `/sph/` 后走独立后台处理） ｜ 记录：Codex

- 無涘直接提供第二条链接 `https://weixin.qq.com/sph/AIRbCztVZu`，因此不再重扫今天整批或继续操作微信。
- 首次显式运行暴露假成功：manifest `selected=0`、exit 0。根因是 `--url` 仍只在本地索引中查找。按 TDD 新增“空索引 + 合法显式 URL”红灯测试后，改为直接创建 `source=explicit_url` 任务。
- 真实重跑完成 `selected=1 / written=1 / failed=0`：29 秒媒体、2 个 ASR 分片、207 字临时逐字稿、230 字摘要和 7 条要点；笔记写入 PKM 后独立回读通过，临时媒体与逐字稿已删除。
- 两条视频任务现在均为 `written`，源链接不同，笔记各自包含摘要与要点。第二条链接由用户提供，所以多卡 UI 自动提链仍留待下一次自然批次验收。
- Skill 分流契约已写明：文章结果交既有 Web Clipper，视频结果交后台视频处理器；两条分支分别验收 manifest。全模块测试 128/128，两个 Skill 官方校验通过。

产出：第二篇 PKM 视频笔记、显式 URL 选择修复、微信主窗选择修复、两个 Skill 的类型路由说明。

原始对话：dialogues/2026-0822.md「1715 两条视频号补抓与分流定案」

## 1405 视频笔记可移植命名与原子发布

决策：無涘 ｜ 记录：codex（自动）｜ session 01a0292f-6d84-73a1-b465-234f372b03ba

完成视频号笔记处理的完整实现：接入共享可移植命名模块（日期前缀、去尾部hashtags、冲突哈希路径），分离 raw/semantic title（前者保留在 metadata，后者用于文件名和 YAML/H1），并通过严格 verifier 验证 frontmatter、H1、章节、路径 basename 的精确匹配。新增同进程 keyed queue（NFKC+lowercase path+stem 为键）串行化并发写入，防止 hash 抢跑。最后将写入改为「临时文件写满 → fs.link 原子发布 → 清理临时文件」，确保 final .md 在发布前不可见。测试从 130 增至 142，含慢写 barrier、跨进程真实并发、cleanup 失败注入等场景。提交记录：35d317a、d11aae6、1a2d401、ebea994，均仅修改 lib 和 test 两文件。APFS 上 link 发布已通过真实子进程验证，无覆盖风险。

原始对话：dialogues/2026-0823.md

## 1826 三轮代码审查：原子发布修复与合并评估

决策：無涘 ｜ 记录：codex（自动）｜ session 01a02934-eb60-7fd1-ab14-e818af091c98

本次会话对 video-channel-pipeline.js 进行三轮只读生产质量审查。第一轮发现三个 Important 问题：复用分支未验证笔记语义导致残缺文件被误复用；路径选择与 wx 创建存在 TOCTOU 竞态；写入/回读异常未删除半成品。修复后第二轮确认同进程路径已可靠，但发现跨进程慢写窗口（第二进程将未写完的 base 误判为未知占用）和 cleanup 错误被静默吞没。第三轮实现原子发布方案：完整笔记先写入同目录唯一 temp，验证后通过 fs.link 原子发布，final 路径不暴露半成品。实测跨进程同源慢写场景下，父进程先发布后子进程正确识别 EEXIST 并复用，最终仅保留一个文件；cleanup EPERM 注入返回 note_cleanup_failed 且 AggregateError 同时保留原始错误。所有测试通过（focused 17/17、full 142/142、跨进程测试连续3次通过），diff 仅涉及两个文件，工作树干净。评估结论：Ready to merge: Yes。

原始对话：dialogues/2026-0823.md「1826 wechat-video-channel-processing」

## 0001 视频号链接批量处理与管线修复

决策：無涘 ｜ 记录：codex（自动）｜ session 01a04911-d358-7e61-90e5-0a13d7881c0e

会话聚焦于处理8条已收集的微信视频号短链（`/sph/`）。经核查发现：8条短链实际只对应3个唯一视频，其余5条为重复分享。处理过程中暴露并修复多个问题：（1）GitHub副本找不到Director工作区V2T路径，导致ASR失败；（2）不同短链指向同一视频时重复建笔记；（3）低信息ASR（如仅转录出"系统。"）被误判为成功；（4）无旁白短视频需补充抽帧OCR视觉证据。修复后采用TDD方式验证，新增内容级去重、抽帧OCR兜底、证据类型区分等逻辑。最终成功写入3篇PKM笔记：游戏设计哲学（1182字语音）、发制戒指（10帧视觉OCR）、token额度（116字语音）。探针产生的假成功笔记已移入quarantine。代码提交`bba46be`，两个AI-Clippings副本及GitHub统一到`1748c08`，测试188/188通过。

原始对话：dialogues/2026-0829.md「0001 wechat-video-channel-processing」

## 1315 视频号跳过根因确认与全自动处理方案设计

决策：無涘 ｜ 记录：codex（自动）｜ session 01a027da-4e12-76c3-a39e-34d494386966

本场会话完成两件事：一是钉死视频号跳过的根因，二是设计打通方案。根因已确认：`video_channel` 跳过规则自3月29日加入后未变，8月18日项目快照把「设想中的 pending 队列 + V2T + 摘要写回」误写为已完成状态，实际从未落地；原始验收只要求「视频号有记录，不承诺完整内容」。诊断留痕已提交为 `bf41ac5`。用户明确要求全自动打通后，AI调查了现有可复用边界：普通分享卡片已有点击→查看器→关闭→回校验的完整自动化流程，视频号只是在此流程之前就被提前分流，可直接复用。音频采集侧排除了 AudioTee（PID 抓取在目标进程无声时会失败），V2T 本机已装 FunASR Nano/Qwen3-ASR/SenseVoice 三套模型但只有 Electron IPC 入口、无 CLI。会话中段插入了迁移工具的安全重构，修复了 quarantine race、旧文件覆盖竞态等，专项从 57 项增至 83 项全绿，并完成了三篇真实 PKM 笔记迁移（含两条视频号 task 更新），提交为 `5a719dd5`，最后并入 main。下一步如需继续视频号打通，需先让 V2T 暴露稳定的 WAV 转写 CLI 入口，再串联播放检测与 Obsidian 写回。

原始对话：dialogues/2026-0910.md「1315 wechat-video-channel-processing」
