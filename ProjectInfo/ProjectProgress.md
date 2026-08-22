# ProjectProgress

> 现状快照，覆盖写，不堆历史。历史看 `ProjectInfo/sessions/` 与 `ProjectInfo/dialogues/`。

*更新于 2026-08-22 · 记录者 Codex*

## 现在在哪

- 微信 FileHelper 的文章卡片链路保持可用；查询结果把 `/sph/` 单列为 `video_channels`，不会误送给文章 Web Clipper。
- 今天两条视频号现在都已写入 PKM：第一条由 UI 自动提取 `/sph/`，第二条由無涘直接提供 `/sph/AIRbCztVZu` 后走同一后台链路。两个 task 均为 `written`，源链接不同，分别有 8 条和 7 条要点。
- 第二条真实运行 `local/video-channel/runs/2026-08-22T09-29-01-472Z/manifest.json`：`selected=1 / written=1 / failed=0`，视频 3,115,280 字节、29 秒，本机 V2T 完成 2 个分片并产出 207 字临时逐字稿，Codex 生成 230 字摘要与 7 条要点。
- 第二篇笔记已独立回读：`source` 精确匹配 `/sph/AIRbCztVZu`，包含「高质量摘要」「关键要点」且无逐字稿章节；两个任务的 MP4、逐字稿和 `.part` 文件均已删除。
- 显式 `video:process -- --url` 现可直接处理不在本地索引中的合法 `/sph/`。此前该分支返回 `selected=0` 但 exit 0，已用红灯测试修正为直接创建 `source=explicit_url` 的任务。
- UI 扫描新增聊天主窗选择器：截图蒙层、菜单等窗口不会再被误当成 `Weixin` 主窗，从而避免负坐标点击；viewer 仍保留原前窗选择逻辑。
- 独立元宝浏览器 profile 已由無涘扫码登录。元宝仅把公开分享链接换成腾讯 `token + eid`；媒体继续来自视频号官方 feed API，不调用元宝聊天或总结。
- 后台状态机已实现：`pending → resolving → downloading → transcribing → summarizing → written`。失败进入 `failed`，保留 `failed_stage + error_code` 并追加 `local/video-channel/automation-failures.log`。
- 端到端 Skill 契约已明确：统一采集后，`records[].url` 交给既有 `obsidian-web-clipper-ingest`；`video_channels[].url` 由 `collect` 后台处理。两边分别验收 manifest，不重复实现网页剪藏，也不把视频送进 Web Clipper。
- 模块全套新鲜测试为 128/128 通过；两个 Skill 均通过官方 `quick_validate`。

## 当前阶段

- 视频号“拿到 `/sph/` 后”的后台链路已用两条不同真实视频闭环：原始链接 + 自有高质量摘要 + 关键要点；不默认保留视频或逐字稿。
- 今天两篇最终笔记已完成，但第二条链接来自用户直接提供，因此“同一次真实 UI 扫描自动提取两条不同视频号链接”仍未完成验收，不能把后台两条成功写成前台批量提链已通过。

## 下一步

- 下一次自然批次直接按统一 Skill 契约运行：采集文章与 `/sph/` → 文章交 Web Clipper → 视频后台处理；不要为了今天已完成的第二篇笔记再次重扫或重复转写。
- 用下一次包含两张不同视频号卡片的真实批次验收无候选上限的 UI 提链；必须以两个不同 `/sph/` 为判据，而不是 `failed=0` 或 `share_cards_seen`。
- 若出现 `auth_required`，只需执行一次 `npm run video:auth` 重新扫码，再重跑同一时间范围；已完成任务会跳过。
- 观察元宝未公开解析端点的漂移；任何 `parse_rejected` / `media_missing` 必须保留为明确失败，不得回退为空摘要或元宝总结。
- 后续若本地 Qwen3-ASR 批量耗时过高，再以真实批次数据比较 SenseVoice/云 ASR；目前不提前增加 provider 配置。

## 阻塞 / 待定

- 当前两条内容均已写入 PKM，无即时内容处理阻塞。
- 元宝解析接口是未公开 Web 接口，存在漂移风险；登录态也可能过期，但两者已有不同错误码。
- Codex 摘要会把临时逐字稿发送给用户已登录的 Codex 服务；元宝只看到公开分享链接，不会收到逐字稿。
- 后台真实证据已有两条不同视频（5 分 28 秒与 29 秒）；多卡 UI 自动提链仍只有单卡证据。后台继续顺序处理以保证失败归因和本机资源稳定。
