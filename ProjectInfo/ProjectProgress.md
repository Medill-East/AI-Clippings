# ProjectProgress

> 现状快照，覆盖写，不堆历史。历史看 `ProjectInfo/sessions/` 与 `ProjectInfo/dialogues/`。

*更新于 2026-08-29 · 记录者 Codex*

## 现在在哪

- 文件传输助手 UI 扫描的相对时间统一以用户确认开始后的实际扫描时刻解析；查询上界只用于界面未显示时间的消息，并写入 `message_time_source: range_until_fallback`。旧索引缺少来源时在 Markdown 中明确标为“时间来源未知”，store 新记录写 `database_timestamp`。
- OCR 初判为图片的卡片不会再凭元宝顶栏文案直接改型：顶栏只触发文章探测，只有成功取得 `https://mp.weixin.qq.com/s...` 才确认为文章；无法确认且 UI 已安全恢复时回退为图片 OCR。
- Copy Link 已取得文章 URL、但 viewer 关闭或聊天恢复失败时，链接仍会收录，同时追加 `viewer_recovery` unresolved 并立即停扫；没有 URL 的恢复失败不会发布 OCR，也会显式停扫，避免在未知窗口继续操作。
- 图片 viewer 工具栏 OCR 已与正文分离；图片笔记新增 `content_hash`，旧笔记即使缺少 `message_time_source/content_hash`，只要 `dedupe_key + OCR 正文哈希` 一致即可幂等重扫，正文冲突仍显式报错。
- 图片与视频共用的 Obsidian 目标解析已直接支持 macOS `obsidian.json`，只接受真实 vault 目录；只有 `ENOENT/ENOTDIR` 表示不存在，权限或 I/O 错误会向上抛出，不会静默写进旧 vault。
- 视频号运行时由本包固定依赖 `playwright@1.62.1`，Node 契约提升为 `>=20`，不再借用兄弟项目 `node_modules`。实际本机已通过无网络空白页启动验证。
- 扫描 manifest 新增 `image_candidates_rerouted_to_article`，可观察 OCR 分类漂移。
- 本轮实现提交为 `cb1f6ac` 与 `acb4343`。独立代码复核最终未发现 Critical/Important；完成前验证为 178 pass / 0 fail、全部 JS 语法通过、`git diff --check` 通过，实际 Obsidian 目标解析为 `/Users/haodong/Documents/GitHub/PKM/PlayWithExperiences/Clippings`。

## 当前阶段

- 时间线提前停止、图片误分/写回失败、视频运行时隐式依赖、旧笔记幂等与失败可观测性均已在代码和自动测试中修复。
- 普通文章 Copy Link 已有此前扩展屏单篇现场成功证据；本轮没有重跑整批微信 UI，也没有触发视频号解析、下载、转写或 Codex 摘要等外部批量调用。

## 下一步

- 下次正常采集使用同一时间范围重新 `--reindex`，重点核对 manifest 的滚动终点、`image_candidates_rerouted_to_article`、`image_contents_total` 与 `unresolved_items_total`。
- 图片现场结果同时回读 Obsidian 笔记正文；视频号现场结果分别核对扫描 manifest 与 video-channel manifest，不能只看总退出码。

## 阻塞 / 待定

- 无代码阻塞。
- 两条视频号尚未在本修复版本现场重跑；现场处理会触发腾讯页面/媒体请求、本机转写和 Codex 配额，本场未在缺少明确确认的情况下自动扩大调用。
