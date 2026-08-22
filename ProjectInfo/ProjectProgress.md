# ProjectProgress

> 现状快照，覆盖写，不堆历史。历史看 `ProjectInfo/sessions/` 与 `ProjectInfo/dialogues/`。

*更新于 2026-08-22 · 记录者 Codex*

## 现在在哪

- 2026-08-22 的微信 FileHelper 扫描结果已完成 Obsidian Web Clipper 处理。
- “已收集链接”实际 31 条，均已生成新 note；首轮并发 10 成功 30 条，1 条在并发 2 重试后成功。
- 最终验收确认 31 个新文件均在 `/Users/haodong/Documents/GitHub/PKM/PlayWithExperiences/Clippings`，符合当前 Auto Mover 行为。
- 30 条 source URL 与输入完全一致；小黑盒外链被站点规范化为 `/app/bbs/link/9d5b7253e7c6` canonical URL，note 内容、标题和 `link_id` 均对应原始链接。
- 视频号真实现状（2026-08-22 代码、历史与测试核验）：扫描层识别到视频号后会赋值 `video_channel`，写成 `skipped_card`；查询与 `collect` 只会把它列入“已跳过卡片”，没有继续处理视频的分支。
- 仓库、Git 状态和近期会话中没有独立 pending 队列、音频捕获、V2T ASR、视频摘要或 Obsidian 写回的实现证据；此前“已接入视频处理”的快照属于错误状态记录。

## 当前阶段

- 文章剪藏链路本批次完成；视频号仍保持“只留记录”的当前实现。

## 下一步

- 后续批次继续使用 `OBSIDIAN_CLIPPER_MAX_CONCURRENCY=10`。
- 最终验收继续按 vault 中的 source URL 和 Auto Mover 最终路径核对；对外链保留 canonical URL 映射检查。
- 若升级视频处理，先只验证手动播放一张视频号卡片能否稳定捕获正确音频并完成一次本地转写，再设计后续队列和写回。

## 阻塞 / 待定

- Vision 为 AI 草稿，待無涘确认。
- 本批次待确认的截断链接 `https://www.zhihu.com/question` 未自动处理；14 个跳过卡片也未纳入文章剪藏。
- 视频处理仍受播放控制、音频来源、结束判断、转写工具和 Obsidian 写回方案约束，不能记作已实现。
