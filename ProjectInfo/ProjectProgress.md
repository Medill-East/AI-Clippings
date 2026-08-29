# ProjectProgress

> 现状快照，覆盖写，不堆历史。历史看 `ProjectInfo/sessions/` 与 `ProjectInfo/dialogues/`。

*更新于 2026-08-29 · 记录者 Codex*

## 现在在哪

- 2026-08-29 03:18 UTC 的真实整批运行扫描到第 20 页、取得 36 个唯一链接，并在末页看到 `Yesterday 21:25`；该时间早于查询下界 23:00，因此本次时间线实际已完整覆盖，不是提前停止。
- 扫描现会把 `pages_scanned`、`scrolls_performed`、`termination_reason`、`range_coverage` 与 `oldest_visible_message_time` 写入 manifest，并在终端直接显示覆盖结论。`max_scrolls`、候选生成失败或 viewer 恢复失败会明确标为 `incomplete`。
- 图片 viewer 不再以“窗口已出现”替代“内容已加载”：最多重复取样 5 次，只有工具栏下方出现正文才进入 OCR；持续空白或 Loading 会成为显式 `image_ocr_empty`，不会写入 PKM。
- 本次两张有真实正文的图片已经写入 Obsidian `needs_review`；由空白 Loading 页产生的 `•••6upeoT` 假笔记已移出 Clippings，保存在 `wechat-filehelper-macos-ingest/local/quarantine/false-positive-image-notes/` 以便恢复。
- OCR 独立行以句点结尾时不再直接确认 URL；现场误收的 `https://en.itu.` 现在会以 `terminal_period` 进入待确认外链，完整的 `https://en.itu.dk/...` 仍正常收录。
- 8 条视频号 `/sph/` 链接均已从微信成功取得；后台失败点是独立元宝 profile 返回 HTTP 401，不是微信登录或提链失败。批处理现在首个 `auth_required` 后立即熔断，其余任务标为 `not_attempted`，并提示 `npm run video:auth`。

## 当前阶段

- 新增修复提交：`b8ac875`。
- TDD 红绿证据覆盖图片 Loading 假成功、OCR 句点截断 URL、时间线完整/不完整状态，以及视频认证熔断。
- 完成前验证：`npm test` 为 182 pass / 0 fail；全部 `scripts/` 与 `test/` JavaScript 通过 `node --check`；`git diff --check` 通过。
- 未重新执行微信 UI 整批，也未在缺少批量外部调用确认时重跑 8 条视频处理；当前现场数据由既有 run artifacts 回放验证。

## 下一步

- 先运行 `npm run video:auth` 完成元宝独立 profile 登录；得到明确批量处理确认后，可用现有索引运行 `npm run video:process -- --since 2026-08-28T23:00:00 --until 2026-08-28T23:59:59`，无需再次扫描微信。
- 下次正常 `--reindex` 后，以新 manifest 的 `range_coverage: complete` 与 `termination_reason: reached_before_since` 验收时间线，并确认空白 Loading 图片只进入 unresolved、不再生成笔记。

## 阻塞 / 待定

- 视频内容写回仍受元宝独立登录态阻塞；微信重新登录不能替代该 profile 的认证。
- 代码无已知阻塞；视频端到端结果在重新认证并实际处理前保持“未验证”，不表述为成功。
