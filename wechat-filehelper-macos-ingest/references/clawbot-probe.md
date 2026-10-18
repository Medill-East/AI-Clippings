# ClawBot 后台提链验证

更新于 2026-10-18 · 记录者 Codex

本机测试成功：公众号卡片和视频号分享由官方 iLink 后端转为 `type=1` 文本，包含标题/描述与原始 URL；合并转发变成 `type=4` ZIP 附件，未展开。6 条消息中提取了 2 个网页链接、1 个视频号短链、1 个 ZIP。用户确认手机 Bot 会话也能直接看到链接。这是本账号/客户端的实测，不保证所有账号和消息都采用相同编码。

`probe-clawbot.py` 是依据腾讯公开协议编写的本地诊断客户端，不是完整安装的 OpenClaw 官方插件。对照官方包版本 2.4.10；不调用模型、不回复、不下载媒体，不操作桌面微信。只读你主动投递到这个 Bot 的消息，不读取其他聊天历史。

## 复用已授权的测试入口

```sh
python3 scripts/probe-clawbot.py listen --seconds 300
node scripts/export-clawbot-links.js
```

收件仅在进程存活时运行，本次实验结束已停止，不是常驻服务。一个账号只运行一个收件进程；每次最多 20 次串行长轮询/300 秒，无自动无限重试。重新扫码用 `qr` 与 `login` 命令，二维码数据保存在本地，展示需本机 QR 渲染器；不能把登录接口失败当成没有消息。

`local/clawbot-probe/` 已被 Git 忽略，目录权限 700，凭据/消息文件权限 600。凭据只供该机器使用；消息中的 context token、媒体解密参数已脱敏，因此该诊断记录不用于后续下载 ZIP。`cursor.json` 用于继续接收，不保证恢复退出期间的全部消息。

离线导出：
- `article-links.txt`：网页/公众号链接，兼容 Web Clipper `--input`。
- `video-links.txt`：视频号 `/sph/` 链接，供原视频处理器使用，不交给文章剪藏器。
- `links.json`：URL 去重后的分流结果，显式列出未展开附件及未知消息类型。

使用时优先逐条转发文章/视频号；合并转发当前只确认 ZIP 投递，不声称内部链接已解析。链接中保留必要查询参数；公众号短链去追踪参数沿用现有 common.js。

## 来源与限制

- https://github.com/Tencent/openclaw-weixin/blob/main/docs/protocol.md
- https://github.com/Tencent/openclaw-weixin/issues/198 ：2026-10-14 作者报告“许愿成功”并关闭；搜索摘要仍显示过时 open 状态。
- https://github.com/Tencent/openclaw-weixin/issues/86 ：公众号/视频号需求记录；实际收件可转换为 TEXT，不能仅凭类型枚举判断不支持。
- https://github.com/cyrahs/fav/pull/63 ：第三方尝试接文件助手，后被 #66 撤回；此记录不能证明当前官方 ClawBot 不可用。

本次只验收接收/提链，没有运行文章抓取、视频解析、ASR、模型摘要或 PKM 写入。后续自动运行这些步骤须遵循原有批量/费用授权。
