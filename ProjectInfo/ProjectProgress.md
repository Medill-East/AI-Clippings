# ProjectProgress

> 现状快照，覆盖写，不堆历史。历史看 `ProjectInfo/sessions/` 与 `ProjectInfo/dialogues/`。

*更新于 2026-08-22 · 记录者 Codex*

## 现在在哪

- 微信 FileHelper 的文章卡片链路保持可用；查询结果现在把 `/sph/` 单列为「视频号（后台处理）」，不会再误送给文章 Web Clipper。
- 视频号全链路已完成单卡真实验收：现有 UI/OCR 流程自动点开卡片、复制公开 `/sph/`、关闭 viewer；前台占用约数秒，不等待视频播完。
- 独立元宝浏览器 profile 已由無涘扫码登录。元宝仅把公开分享链接换成腾讯 `token + eid`；媒体继续来自视频号官方 feed API，不调用元宝聊天或总结。
- 后台状态机已实现：`pending → resolving → downloading → transcribing → summarizing → written`。失败进入 `failed`，保留 `failed_stage + error_code` 并追加 `local/video-channel/automation-failures.log`。
- 真实端到端运行 `local/video-channel/runs/2026-08-22T08-34-38-009Z/manifest.json`：`selected=1`、`written=1`、`failed=0`。媒体 11,475,719 字节、328.21 秒；本机 V2T Qwen3-ASR 完成 19 个分片并产出 1,295 字临时逐字稿；Codex 生成 601 字摘要与 8 条要点。
- Obsidian 笔记已写入并独立回读验证：源 `/sph/` 匹配，包含「高质量摘要」「关键要点」，无逐字稿章节；临时 MP4、WAV、逐字稿均已删除。
- 同一时间范围幂等复跑在 1 秒内完成：`written=0`、`skipped=1`、`failed=0`，没有重复下载、转写或写笔记。
- `collect` 现在默认在微信扫描结束后继续视频号后台批处理；显式 `--skip-videos` 才跳过。单独入口为 `npm run video:auth` 与 `npm run video:process`。
- 模块全套新鲜测试为 126/126 通过。此前两项 query 失败的根因是测试硬编码执行另一个 checkout，已改成当前测试文件相对路径；不是业务标题冲突。

## 当前阶段

- 视频号第一版产品契约已在真实单卡上闭环：原始链接 + 自有高质量摘要 + 关键要点；不默认保留视频或逐字稿。
- 当前代码具备时间范围批处理、逐条持久化、失败留痕和幂等重试；尚未用包含多张不同视频号卡片的真实批次做耐久验收。

## 下一步

- 下一次真实 FileHelper 批次直接使用原 `collect` 命令，观察多视频混合文章时的顺序、耗时和失败隔离；不需要再手工播放视频。
- 若出现 `auth_required`，只需执行一次 `npm run video:auth` 重新扫码，再重跑同一时间范围；已完成任务会跳过。
- 观察元宝未公开解析端点的漂移；任何 `parse_rejected` / `media_missing` 必须保留为明确失败，不得回退为空摘要或元宝总结。
- 后续若本地 Qwen3-ASR 批量耗时过高，再以真实批次数据比较 SenseVoice/云 ASR；目前不提前增加 provider 配置。

## 阻塞 / 待定

- 当前无即时阻塞。
- 元宝解析接口是未公开 Web 接口，存在漂移风险；登录态也可能过期，但两者已有不同错误码。
- Codex 摘要会把临时逐字稿发送给用户已登录的 Codex 服务；元宝只看到公开分享链接，不会收到逐字稿。
- 真实证据目前只有一条 5 分 28 秒视频；批量并发策略尚未实测，当前故意顺序处理以保证失败归因和本机资源稳定。
