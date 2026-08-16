# 决策摘要：2026-08-16 WeChat FileHelper

## 当前状态

- 文字卡片的 UI OCR 提取链路已基本稳定。
- 本次保存的修复针对单行文章标题与独立来源行被 OCR 拆开时的漏识别。
- 视频号和视频链接目前仍是待设计的扩展范围，现有链路会对明确的视频卡片做跳过记录。

## 决策与理由

- 对带《书名号》或明确分隔符的可信单行标题，允许与相邻来源 footer 合并；不扩大全局 OCR cluster 间距，避免误合并相邻卡片。
- 暂不把视频号/视频总结逻辑混入稳定的文字卡片提取主链路。视频号首先需要确认能否复制出稳定 URL；视频链接则应先按平台获取字幕/转录，再进入 Obsidian 摘要流程。
- 低风险扩展方向是把视频作为独立内容类型保留 URL、平台和待处理状态，而不是静默丢弃。

## 改动与验证

- 修改 `wechat-filehelper-macos-ingest/scripts/lib/ui.js`。
- 增加 `wechat-filehelper-macos-ingest/test/ui.test.js` 回归测试。
- 已通过 UI 测试、项目测试和 `git diff --check`。

## 事故教训

- “没有小标题”本身不应使卡片失效；OCR 分组必须允许标题与来源 footer 分离后再做窄范围合并。
- 弱 OCR 线索不能通过放大全局容差解决，否则会把相邻卡片合并。

## 未决问题

- 首批支持哪些视频平台：视频号、YouTube、Bilibili，还是仅处理能得到稳定 URL 的视频号卡片。
- 只保存摘要还是同时保存完整转录。
- 转录优先使用本地 ASR，还是允许外部服务。

## 下一步

- 先确认视频号 viewer 菜单是否能复制稳定链接。
- 为视频链接设计独立的 `pending_video`/视频内容记录，再接入字幕或 ASR 适配器。

## 视频号公开方案调研

- 现有公开实现普遍区分 `https://weixin.qq.com/sph/<id>` 分享链接和真正的 `finder.video.qq.com` 媒体地址；前者可作为记录标识，后者通常是带签名、会过期的播放资源。
- `ltaoo/wx_channels_download` 提供 macOS/Windows 本地捕获方案：微信 PC 播放视频时，通过本地代理/证书捕获媒体请求；其 `parse_sph` 接口也支持从分享链接解析详情，但文档要求配置元宝 Web 登录态 cookie。
- 另有项目通过公开 metadata API 获取视频号描述、封面、时长和作者信息，但不获取 mp4；这条路径可以先支持“元数据摘要”，不能替代音频转录。
- 本项目建议先尝试一次卡片/消息菜单复制 `sph` 分享链接，成功则记录 `pending_video`；只有明确启用本地媒体捕获时，才引入代理、证书和 ASR 风险。

参考：[wx_channels_download](https://github.com/ltaoo/wx_channels_download)、[parse_sph 文档](https://github.com/ltaoo/wx_channels_download/blob/main/docs/public/openapi/channels/parse_sph.json)、[weixin-articles-mcp 的 Channels 说明](https://github.com/jj-cheng25/weixin-articles-mcp#why-no-channels-mp4)

## 轻量视频总结方案

- 用户不需要保存完整视频；可在微信播放时捕获音频，交给 ffmpeg 和分段 ASR，使用内存/短时临时片段作为缓冲，完成后删除媒体片段，只保留转录摘要和原始分享标识。
- 如果不想先解决分享 URL，视频 worker 可以按 FileHelper 卡片指纹启动一次播放捕获；分享 URL 只作为可选的来源字段。
- 为复用现有 Obsidian Web Clipper，可生成短时本地 transcript 页面，让 clipper 总结该文本并写入 PKM，成功后删除临时页面。
- 需要在“本地 ASR（隐私好、首次模型较重）”和“外部 ASR（本机轻、会发送音频）”之间做选择；没有音频字节就无法生成基于语音内容的摘要。

证据记录：[2026-08-16 会话记录](2026-08-16-wechat-filehelper-transcript.md)
