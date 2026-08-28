# ProjectProgress

> 现状快照，覆盖写，不堆历史。历史看 `ProjectInfo/sessions/` 与 `ProjectInfo/dialogues/`。

*更新于 2026-08-28 · 记录者 Codex*

## 现在在哪

- 2026-08-28 23:00–23:59 的真实混合内容扫描已完成取证，运行目录为 `/Users/haodong/Documents/GitHub/AI-Clippings/wechat-filehelper-macos-ingest/local/runs/2026-08-28T15-42-04/`：OCR 看见 82 次卡片候选，35 次进入 viewer 提取，24 条公众号文章成功，4 次 viewer 未就绪，14 次按规则跳过；最终索引 37 行。
- 本次实际运行的是 GitHub 工作副本提交 `5126e6f`；受 Director 治理的当前工作副本是 `/Users/haodong/Documents/AI/Codex/Clippings` 提交 `b7b5ade`。两份仓库历史已经分叉，旧副本没有当前 `/sph/` 视频号 Copy Link 与后台状态机。
- 漏点根因已由 `candidates.json` 确认：旧版去重把每一行 OCR 文本及 10 字片段都注册为同一文章的别名，导致至少三篇不同文章被误判为已解析——“南洋理工…”被相邻“让程序员…”文本污染，“Friend Slop…”与既有文章共享 `GameRes 游资网` 页脚，“众神的权柄（上）”与“（下）”共享前缀。
- 图文卡片确实被点击并打开，但旧版只接受公众号文章壳；该微信图文 viewer 被判为 `partial_title / article_shell_loaded=false`，4 次尝试均以 `viewer_not_ready` 结束，Copy Link 菜单分支未执行。
- 视频号候选在旧版打开后被 viewer OCR 判为 `video_channel`，随后进入通用 `skipped_card` 分支；没有 `/sph/`、没有 pending 任务，也没有后台处理。本次 7 条跳过记录包含同一视频在相邻页面/不同 OCR 簇中的重复，不代表 7 个唯一视频。
- 图片消息只做了整屏 Vision OCR；OCR 文本随后被归为 `plain_text_block` 或 `weak_ocr_card` 并跳过。仓库没有正式的图片/OCR 内容记录类型与写回链路，因此这是功能缺口，不是一次偶发 OCR 失败。
- 两条裸链接在截图 OCR 中可复现，但消息块构造将其丢弃：单行 `kmjn.org` 被 `cluster.length < 2` 过滤；三行 `en.itu.dk` 的首行 x=779，小于整屏 56% 的硬边界约 x=825，整条消息未进入右侧候选。剪贴板兜底每页只有换行，无法补回。
- 当前新版已实现视频号 `/sph/` 提链并放宽 viewer 就绪判断；但用本次 OCR 离线回放，两个裸链接仍为 0 条，图片内容链仍不存在，10 字前缀去重仍可能把上下篇合并。
- 本轮仅诊断，没有修改生产代码。旧版、新版 `node --test test/ui.test.js` 分别 91/91 与 48/48 通过，说明测试缺少这批真实布局的回归样本，不能据此判定采集完整。

## 当前阶段

- 五类现象都已从真实 manifest、候选明细、OCR JSON 和截图定位到具体阶段；“没看到”“没点”“点了没取到”“取到 OCR 后主动丢弃”已经分开。
- 修复尚未开始；用户本轮要求是检查问题，未授权改动采集逻辑。

## 下一步

- 若無涘授权修复，先确定唯一运行仓库/分支，避免在旧 GitHub 副本继续验证已经废弃的视频架构。
- 按独立假设建立五组真实样本红灯：异文同页脚/同前缀不得去重；图文 viewer 必须走 Copy Link；视频号必须得到唯一 `/sph/`；图片必须产生 OCR 内容记录；单行与宽换行裸链必须入库。
- 每次只修一个数据边界并离线回放本次 artifacts；最后才做一次真实 UI 批次验收。验收应按唯一可见消息逐项对表，不能只看 `failed=0`、`share_cards_seen` 或单测全绿。

## 阻塞 / 待定

- 两份同 remote 的本地仓库历史分叉，哪一份作为唯一真源需要先收束；直接在两边分别补丁会继续制造漂移。
- 图片 OCR 的最终内容契约仍需在实现时明确：至少需要原始 OCR 文本、来源时间、可追溯截图/消息标识与置信/失败状态；不能把 `skipped_card.raw_text` 冒充正式收录。
- 最终真实验收需要微信窗口和同类消息样本；当前离线证据足以确认根因，但不能把“修复方案可行”写成“已经修好”。
