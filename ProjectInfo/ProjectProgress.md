# ProjectProgress

> 现状快照，覆盖写，不堆历史。历史看 `ProjectInfo/sessions/` 与 `ProjectInfo/dialogues/`。

*更新于 2026-08-22 · 记录者 Codex*

## 现在在哪

- 2026-08-22 的微信 FileHelper 文章批次已完成 Obsidian Web Clipper 处理：31 条链接均生成 note，并经 vault 中 source URL 复核。
- 视频号第一阶段「前台短时提链」已真实打通：复用现有文章卡片的识别、点开和关闭链路，新增视频号 viewer 识别与底部分享面板处理，接受 `https://weixin.qq.com/sph/...`。
- 单卡真实验收运行 `wechat-filehelper-macos-ingest/local/runs/2026-08-22T07-34-03/manifest.json`：`collected=1`、`share_cards_resolved=1`、`share_cards_unresolved=0`、索引新增 1 条；候选状态为 `resolved`，URL 类型经正则复核为 `/sph/`，结束后微信只剩一个主窗口。
- 该过程不等待视频播完：播放器只短暂打开到分享链接可复制，随后立即关闭；前台占用不随视频时长增长。
- 为兼容微信 4.1.11 主窗口 `sharingState=0`，截图定位改用微信自带截图蒙层，并确保双 `Esc` 清理；视频号分享菜单改用 viewer 局部截图，避免多显示器 OCR 坐标偏移。
- 第二阶段「后台媒体解析 → 我们自己的摘要和要点 → Obsidian」尚未实现，不能称为全链路完成。当前索引只有分享链接，没有媒体、逐字稿、摘要或要点。
- 视频号官方预览页及前端脚本已核验：`/sph/` 可匿名后台访问，但官方 `get_feed_info` API 在空登录态下明确返回 401 `permission verification failed`；分享页不下发 cookie，补齐 `_rid/_pageUrl` 后结果不变。
- 本机微信缓存路径已按真实请求强校验：近期 `finder.video.qq.com` 条目全部是 JPEG 封面；xworker IndexedDB 没有 `videoUrl`/MP4/M3U8，不能把封面或加密 blob 冒充视频。
- 现成 `jianminggan/wechat-video-subtitle` 源码证明可复用的干净路径是：元宝登录态只负责把分享链接换成 `token + eid`，随后调用视频号官方接口拿媒体；不需要采用元宝总结。当前 Chrome 和 Codex 内置浏览器均未登录元宝。
- 本机 V2T 的 sherpa/cloud ASR provider 可复用，但当前没有独立的「媒体文件转写 CLI」；下载链验证后需要做薄适配，不能先记为已接通。

## 当前阶段

- 视频号阶段一已完成并有真实运行证据。
- 视频号阶段二停在「一次性腾讯登录态」验证前：匿名与本机无登录缓存路径已经查尽；尚未获授权打开元宝登录二维码，也尚未验证登录后的单卡媒体解析。

## 下一步

- 获無涘确认后，在独立浏览器 profile 中完成一次元宝微信扫码登录；元宝仅作腾讯域内短链解析凭据，不使用其摘要或聊天产物。
- 只用当前这一条 `/sph/` 做单假设验证：解析出 `token/eid` → 调视频号官方 API → 对媒体 URL 做 HTTP 类型、总大小和 Range 强校验；先不下载整段、也不实现队列。
- 单卡媒体解析通过后，再按 TDD 实现后台任务状态机：`pending → resolving → downloading → transcribing → summarizing → written`，各失败阶段使用不同非空错误码并写 manifest/failure log。
- 为 V2T 增加或复用最薄的文件转写入口，临时逐字稿只作摘要中间产物；最终笔记契约为「原始链接 + 高质量摘要 + 关键要点」，不默认保存完整逐字稿或视频文件。
- 最终验收必须同时核对：微信前台释放时间不随视频时长增长、媒体与源 `/sph/` 正确关联、摘要/要点有实质内容、Obsidian note 真实落盘、任何失败可观察。

## 阻塞 / 待定

- 当前唯一即时阻塞是一次元宝网页登录授权与扫码；这是一回性身份建立，不是每条视频的人工介入。
- 元宝解析端点属于未公开 Web 接口，存在漂移风险；必须保留明确 `auth_required` / `parse_rejected` / `media_missing` 状态，不能返回合法空值。
- `ltaoo/wx_channels_download` 的本地代理/根证书方案仍只作为显式授权后的后备；默认不改系统代理、不装根证书、不关闭 SIP。
- 本批次另有待确认的截断知乎链接及其他跳过卡片，与本次视频号提链提交无关。
