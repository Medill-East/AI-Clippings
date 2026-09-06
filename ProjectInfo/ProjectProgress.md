# ProjectProgress

> 现状快照，覆盖写，不堆历史。历史看 `ProjectInfo/sessions/` 与 `ProjectInfo/dialogues/`。

*更新于 2026-09-06 15:53 · 记录者 Codex*

## 现在在哪

- 2026-09-06 扫描 manifest 已确认时间线完整覆盖：15 页、14 次滚动、25 条唯一链接，`range_coverage=complete`、`termination_reason=reached_before_since`；其中 22 条公众号文章、3 条视频号，另有 2 条图片 OCR 和 4 条 unresolved 项。
- 图片 OCR 的 2 条内容已由扫描器写入 Obsidian `needs_review`；4 条 unresolved 没有可靠 URL，仍未擅自补全。
- 22 条公众号文章已通过 Web Clipper 写入 Obsidian `Clippings/WeChat/2026`。首轮并发运行曾产生 5 条 active-tab 错配假成功，已由 URL-to-tab 修复后的串行重跑纠正；5 个错配笔记已移至 `obsidian-web-clipper-ingest/local/quarantine/false-success/2026-09-06-concurrent-tab-mismatch/`，可恢复。
- 最终文章验收为 22/22：每条 `clipTarget.sourceUrl` 与请求 URL 一致，22 个笔记路径互不重复，文件均存在、非空并含对应源 URL。
- 原扫描命令列出的 3 个视频号短链已经真实解析并确认内容指纹完全相同，实际只有 1 个 3054.55 秒视频。首次正式重跑正确收束为 `3 → 1`，但下载 151,861,509 bytes 后在长音频 recovery 初始化处以 `ENOENT` 失败；未调用摘要模型、未写入 PKM，另外两个别名明确标为未尝试。

## 当前阶段

- 视频批处理现先解析全批身份并按内容指纹去重，再启动唯一视频重任务；终端会显示“3 个分享短链 → 1 个唯一视频”，重任务进度使用 `[video 1/1]`。
- 本机 ASR 现复用 V2T 的可恢复分片 worker，每个 20 秒分片在独立进程中执行并逐片留痕；带临时签名参数的封面 URL 不再写入任务状态。
- 视频修复提交 `a38176a`、`649641d`、`d3c2384` 均已推送；实现真源与 GitHub 运行副本已 fast-forward 到 `d3c2384`。完整测试为 191 pass / 0 fail；真实 21 秒 V2T 边界探针完成 2/2 worker 分片。
- `d3c2384` 按 V2T 标准顺序首次创建 recovery job，重试时复用已有 job；修复了只有音频超过 20 秒才出现的分片目录 `ENOENT`。
- 完整 50 分 54 秒视频已经发起过一次修复后运行，但在 ASR 第一片前停止，因此仍不能宣称新视频已写入 PKM。
- Web Clipper 启动链路已修复：传入配置的 `chromePath`，移除会抑制扩展的 Playwright 默认参数，并按页面 URL 查询 tab ID，避免并发页面把剪藏目标写到别的 URL。
- 由于当前 Google Chrome 152 明确忽略 `--disable-extensions-except`，本机 `local/config.json` 暂使用已存在的 Chrome for Testing 151 缓存；没有下载新浏览器，也没有改用户 Chrome profile。
- TDD 回归与全量测试均通过：`npm test` 为 17 pass / 0 fail；真实批处理 manifest 为 `obsidian-web-clipper-ingest/local/runs/2026-09-06T07-26-52-414Z/manifest.json`，5 条修复重跑 manifest 为 `local/runs/2026-09-06T07-36-22-423Z/manifest.json`。
- 文章输入文件为 `obsidian-web-clipper-ingest/local/inputs/2026-09-06-filehelper-links.txt`，共 22 条唯一 `mp.weixin.qq.com/s/` URL。
- Auto Mover 当前关闭；本轮正确笔记均位于 `Clippings/WeChat/2026`，符合当前设置。

## 下一步

- 如需完成这 1 个唯一视频，需要重新确认第二次正式运行：3 个短链解析、约 152 MB 重新下载、172 个本地 ASR 分片、最多 1 次 Codex 摘要、零重试。验收目标仍为一个 PKM canonical 笔记和两个 `skipped_duplicate` 结果。
- 4 条 unresolved 项没有可靠目标地址，除非补充真实链接，否则保持未解决状态。
- 下次文章批处理需继续验收 `clipTarget.sourceUrl === requested URL`，不能只看 success 或笔记文件存在。

## 阻塞 / 待定

- 2026-09-06 的唯一长视频仍待完整真实运行；首次正式重跑失败后按默认清理删除了媒体和 WAV，下一次必须重新下载，未把 21 秒边界探针通过等同于端到端完成。
- Chrome for Testing 缓存若后续被清理，当前本地配置将失效；需重新提供可用的 headed 浏览器路径或安装兼容的 Playwright 浏览器后再运行。
- 文章剪藏当前无已知阻塞；本轮只处理了公众号文章，未将视频号错误地交给 Web Clipper。
