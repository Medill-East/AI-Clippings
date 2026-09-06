# ProjectProgress

> 现状快照，覆盖写，不堆历史。历史看 `ProjectInfo/sessions/` 与 `ProjectInfo/dialogues/`。

*更新于 2026-09-06 16:28 · 记录者 Codex*

## 现在在哪

- 2026-09-06 扫描 manifest 已确认时间线完整覆盖：15 页、14 次滚动、25 条唯一链接，`range_coverage=complete`、`termination_reason=reached_before_since`；其中 22 条公众号文章、3 条视频号，另有 2 条图片 OCR 和 4 条 unresolved 项。
- 图片 OCR 的 2 条内容已由扫描器写入 Obsidian `needs_review`；4 条 unresolved 没有可靠 URL，仍未擅自补全。
- 22 条公众号文章已通过 Web Clipper 写入 Obsidian `Clippings/WeChat/2026`。首轮并发运行曾产生 5 条 active-tab 错配假成功，已由 URL-to-tab 修复后的串行重跑纠正；5 个错配笔记已移至 `obsidian-web-clipper-ingest/local/quarantine/false-success/2026-09-06-concurrent-tab-mismatch/`，可恢复。
- 最终文章验收为 22/22：每条 `clipTarget.sourceUrl` 与请求 URL 一致，22 个笔记路径互不重复，文件均存在、非空并含对应源 URL。
- 原扫描命令列出的 3 个视频号短链已真实确认是同一个 3054.55 秒视频。第二次正式重跑完成 172/172 个本地 ASR 分片和一次 Codex 摘要；最终 manifest 为 `complete`，计数 `unique_videos=1 / duplicate_links=2 / written=1 / skipped=2 / failed=0`。
- 视频笔记已写入 `PlayWithExperiences/Clippings/《九阴真经：武侠》.md`：16,328 字语音证据生成 873 字摘要和 8 个要点；源链接、类型、正文结构、无签名 URL 泄漏均已回读通过。

## 当前阶段

- 视频批处理现先解析全批身份并按内容指纹去重，再启动唯一视频重任务；终端会显示“3 个分享短链 → 1 个唯一视频”，重任务进度使用 `[video 1/1]`。
- 本机 ASR 现复用 V2T 的可恢复分片 worker，每个 20 秒分片在独立进程中执行并逐片留痕；带临时签名参数的封面 URL 不再写入任务状态。
- 视频修复提交 `a38176a`、`649641d`、`d3c2384`、`b8eee8b` 均已推送；实现真源与 GitHub 运行副本已 fast-forward 到 `b8eee8b`。完整测试为 192 pass / 0 fail；真实长视频完成 172/172 worker 分片。
- `d3c2384` 按 V2T 标准顺序首次创建 recovery job，重试时复用已有 job；修复了只有音频超过 20 秒才出现的分片目录 `ENOENT`。
- 长简介标题现会优先收束为最具体的 `《作品名》`；当前笔记已从句中截断的长文件名修正为 `《九阴真经：武侠》.md`，PKM 提交 `7ed56493` 已推送。
- Web Clipper 启动链路已修复：传入配置的 `chromePath`，移除会抑制扩展的 Playwright 默认参数，并按页面 URL 查询 tab ID，避免并发页面把剪藏目标写到别的 URL。
- 由于当前 Google Chrome 152 明确忽略 `--disable-extensions-except`，本机 `local/config.json` 暂使用已存在的 Chrome for Testing 151 缓存；没有下载新浏览器，也没有改用户 Chrome profile。
- TDD 回归与全量测试均通过：`npm test` 为 17 pass / 0 fail；真实批处理 manifest 为 `obsidian-web-clipper-ingest/local/runs/2026-09-06T07-26-52-414Z/manifest.json`，5 条修复重跑 manifest 为 `local/runs/2026-09-06T07-36-22-423Z/manifest.json`。
- 文章输入文件为 `obsidian-web-clipper-ingest/local/inputs/2026-09-06-filehelper-links.txt`，共 22 条唯一 `mp.weixin.qq.com/s/` URL。
- Auto Mover 当前关闭；本轮正确笔记均位于 `Clippings/WeChat/2026`，符合当前设置。

## 下一步

- 相同时间范围再次运行时，确认一个 canonical 笔记与两个 `skipped_duplicate` 任务都直接复用，不再下载、转写或重复写笔记。
- 4 条 unresolved 项没有可靠目标地址，除非补充真实链接，否则保持未解决状态。
- 下次文章批处理需继续验收 `clipTarget.sourceUrl === requested URL`，不能只看 success 或笔记文件存在。

## 阻塞 / 待定

- 视频处理当前无已知阻塞；成功 manifest、canonical task、两个 alias task 和 PKM 笔记已经互相对齐。
- Chrome for Testing 缓存若后续被清理，当前本地配置将失效；需重新提供可用的 headed 浏览器路径或安装兼容的 Playwright 浏览器后再运行。
- 文章剪藏当前无已知阻塞；本轮只处理了公众号文章，未将视频号错误地交给 Web Clipper。
