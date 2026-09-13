# ProjectProgress

*更新于 2026-09-14 01:29 +0800 · 记录者 Codex*

## 现在在哪

- 用户提供的合并清单包含 20 个唯一链接：19 篇公众号文章和 1 条视频号；第 19、20 项也已按用户后续确认进入正常处理，不再按“已补入”跳过。
- 19 篇文章通过 Web Clipper 写入 `Clippings/WeChat/2026`。首轮并发 10 表面为 19/19 success，但 `clipTarget.sourceUrl` 验收发现 2 条 active-tab 错配；两条已串行重跑并纠正，首轮两份错配副本已移入可恢复隔离区。
- 最终文章验收为 19/19：每条请求 URL 都与剪藏目标一致，19 个笔记路径互不重复，文件均存在、非空且含对应源 URL。
- 视频号 `https://weixin.qq.com/sph/ANrIUogFTH` 已由后台管线完成；解析为 1 个唯一视频，24/24 个本地 ASR 分片完成，摘要和 8 个关键要点写入 PKM，临时媒体与逐字稿已清理。

## 已完成验证

- 文章运行 manifest：`obsidian-web-clipper-ingest/local/runs/2026-09-13T17-17-44-957Z/manifest.json`；两条纠正重跑 manifest：`local/runs/2026-09-13T17-24-01-430Z/manifest.json`。
- 视频运行 manifest：`wechat-filehelper-macos-ingest/local/video-channel/runs/2026-09-13T17-25-29-601Z/manifest.json`，状态 `complete`，`selected=1 / unique_videos=1 / written=1 / failed=0`。
- 实质验收通过：19 个文章笔记和 1 个视频笔记均有正确源链接、存在且非空；文章源链接 19/19，视频源链接 1/1；视频 manifest 不含签名媒体 URL。
- `obsidian-web-clipper-ingest` 测试为 17 pass / 0 fail；`wechat-filehelper-macos-ingest` 测试为 222 pass / 0 fail。

## 使用方式与限制

- 文章剪藏使用本机已有的 Chrome for Testing headed 浏览器；当前 Google Chrome 152 不适合命令行扩展加载，配置路径已指向可用缓存。若该缓存被清理，需先恢复兼容浏览器路径。
- 批量文章必须验收 `clipTarget.sourceUrl === requested URL`，不能只看 success、job id 或文件存在；扩展 iframe 内部仍依赖 active tab，因此当前批量运行保留串行纠正路径。
- 本轮使用的文章输入为 `obsidian-web-clipper-ingest/local/inputs/2026-0914-merged-article-links.txt`；原始合并清单未重新扫描微信，未改变索引。

## 下一步

- 本轮 20 条链接无剩余处理项。后续新链接继续按文章 / 视频号分流，并分别核对各自 manifest 与实际 PKM 产物。

## 阻塞 / 待定

- 本轮无已知阻塞；第 20 条视频未要求重新登录即完成。
