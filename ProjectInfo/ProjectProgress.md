# ProjectProgress

> 现状快照，覆盖写，不堆历史。历史看 `ProjectInfo/sessions/` 与 `ProjectInfo/dialogues/`。

*更新于 2026-08-29 13:17 · 记录者 Codex*

## 现在在哪

- 2026-08-29 03:18 UTC 的真实整批运行扫描到第 20 页、取得 36 个唯一链接，并在末页看到 `Yesterday 21:25`；该时间早于查询下界 23:00，因此本次时间线实际已完整覆盖，不是提前停止。
- 扫描现会把 `pages_scanned`、`scrolls_performed`、`termination_reason`、`range_coverage` 与 `oldest_visible_message_time` 写入 manifest，并在终端直接显示覆盖结论。`max_scrolls`、候选生成失败或 viewer 恢复失败会明确标为 `incomplete`。
- 图片 viewer 不再以“窗口已出现”替代“内容已加载”：最多重复取样 5 次，只有工具栏下方出现正文才进入 OCR；持续空白或 Loading 会成为显式 `image_ocr_empty`，不会写入 PKM。
- 本次两张有真实正文的图片已经写入 Obsidian `needs_review`；由空白 Loading 页产生的 `•••6upeoT` 假笔记已移出 Clippings，保存在 `wechat-filehelper-macos-ingest/local/quarantine/false-positive-image-notes/` 以便恢复。
- OCR 独立行以句点结尾时不再直接确认 URL；现场误收的 `https://en.itu.` 现在会以 `terminal_period` 进入待确认外链，完整的 `https://en.itu.dk/...` 仍正常收录。
- 元宝独立 profile 重新认证后，8 条 `/sph/` 链接已完成真实后台处理。它们实际对应 3 个唯一视频：3 条写入 PKM，另外 5 条按解析后的内容身份标为 `skipped_duplicate` 并指向 canonical 笔记；最终 manifest 为 `written=3 / skipped=5 / failed=0`。
- 视频运行时会在 GitHub 副本找不到兄弟 V2T 时继续寻找 `~/Documents/AI/Codex/V2T`；本次长视频得到 1182 字语音证据，戒指短视频因 ASR 只有“系统。”而自动改走 10 帧 Vision OCR，第三条得到 116 字语音证据。
- 视频笔记标题只取解析描述首段；语音与画面 OCR 在证据和 manifest 中明确区分。探针产生的低信息假成功笔记已移入 `local/video-channel/quarantine/false-success/`，最终三篇 PKM 笔记均已回读验收。

## 当前阶段

- 本轮视频修复提交：`bba46be`；两份本地 AI-Clippings 与 GitHub 经合并后统一到 `b659cdf`。
- TDD 红绿证据新增 V2T 路径发现、Swift Vision 二进制缓存、低信息 ASR 视觉回退、内容级短链去重、证据字段和视频标题收束。
- 完成前验证：`npm test` 为 188 pass / 0 fail；全部 `scripts/` 与 `test/` JavaScript 通过 `node --check`；`git diff --check` 通过。
- 真实视频 manifest：`wechat-filehelper-macos-ingest/local/video-channel/runs/2026-08-29T04-55-14-837Z/manifest.json`，状态 `complete`；三篇笔记均存在、非空且不含探针假成功措辞。
- 本轮附件已解析出 28 条完整文章/网页 URL，生成 `obsidian-web-clipper-ingest/local/inputs/2026-08-29-filehelper-links.txt`；输入校验为 28 条唯一 URL、无视频号链接。
- `obsidian-web-clipper-ingest/scripts/setup.js` 本地预检通过：Chrome、自动化 profile 与 Web Clipper `1.7.1_1` 可用。
- 本轮 Web Clipper 已按并发 10 处理 28 条 URL，并按技能完成并发 2、1 的失败重试；最终 27 条成功、1 条失败。27 条成功 URL 均在 vault 中唯一匹配到非空 Markdown 笔记，当前实际位置为 `Clippings/WeChat/2026`。
- Auto Mover 当前关闭；上述 `Clippings/WeChat/2026` 位置符合当前设置，不是剪藏失败或路径异常。

## 下一步

- 本轮视频无需再处理；重复运行同一时间范围会复用已验证笔记并计入 skipped。
- 如需补齐本轮结果，应先确认 `https://en.itu/` 的真实完整地址；该地址在三次尝试后仍返回 `ERR_CONNECTION_CLOSED`，不能擅自推断为同批次另一个 `https://en.itu.dk/...` 地址。
- 下次正常 `--reindex` 后，以新 manifest 的 `range_coverage: complete` 与 `termination_reason: reached_before_since` 验收时间线，并确认空白 Loading 图片只进入 unresolved、不再生成笔记。

## 阻塞 / 待定

- `https://en.itu/` 未生成笔记，失败原因已记录为 `page.goto: net::ERR_CONNECTION_CLOSED`；其真实目标未知，不能标记为已处理。
- 代码和本轮视频处理无已知阻塞；仍需在下次正常 `--reindex` 中现场验收新的时间线与空白图片判定。
