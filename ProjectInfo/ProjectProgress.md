# ProjectProgress

> 现状快照，覆盖写，不堆历史。历史看 `ProjectInfo/sessions/` 与 `ProjectInfo/dialogues/`。

*更新于 2026-09-14 00:28 +0800 · 记录者 Codex*

## 现在在哪

- 9/14跨午夜新运行 2026-09-13T16-13-21 仍未验收：manifest collected=19 是19条链接记录，实际18个URL。凌晨“我们不该逼着所有人都上班”被visible timestamp与占位各存一次；查询按URL去重，故实际输出18条。相对上一轮15URL，新增UCSD、Gwen与凌晨新文章3个URL。
- 时间新增确证：Claude Science 的21:06被按运行日9/14解析成当天晚间，而扫描在9/14凌晨完成，出现未来消息时间；这是裸HH:mm跨日归属问题，不是UTC显示或无时间占位本身。截图的Yesterday16:09旧图片仍作为无时间失败项输出，属于开始边界较早一侧。
- 候选列表22次duplicate_skipped中19次already_resolved、3次already_attempted；Nicky Case在page5/6/7都被OCR读到但未生成候选，仍真漏检。视频分享截图继续来自终端，Photos and Videos又被背景视频号标签污染；没有任何成功/sph/链接，不能把输出“视频号无”理解为确实没有。
- 清理失败截图现已可复核：标签多后压缩成图标，当前TRPG关闭按钮移至右侧，初始固定点不能可靠适用；此前OCR glyph修补不足。本轮仅审计，未再发猜测性代码补丁。原候选/时间/去重逻辑的改动范围仍待用户确认。

- 最新用户运行 2026-09-13T14-33-06：15 唯一链接、8 unresolved、8 次 image→article 转回；最后清理仍失败。窗口适配本轮进一步修正：疑似图片转文章检查最多3帧；视频号不再看到标题即直接判就绪，最多补3帧等待；读取真实前台独立 viewer，主窗文章只截右侧，避免主窗口内容污染 Photos and Videos/视频判断。
- 清理优先按 OCR 中明确可见的标签关闭 ×/X 定位；无可靠字符仍保留原坐标和失败状态。失败截图现保存至 artifacts/viewer-cleanup-failed.png，便于确认批次标签位移。212/212 全量测试通过；当前微信辅助功能窗口列表为空，未做本轮实机复验。
- 另已确认两条点击前漏检：Gwen 与 Nicky Case 各自为单行标题+带“0”书本图标的作者 footer，二者间距约125–129px，大于旧54px分簇阈值，分成两个单行簇被丢弃。为遵守用户“只改点击、不改原处理”的范围，已询问是否允许最小候选检测修复，尚待选择；时间/去重/分类主算法未更改。

- 用户纠正修复范围：只适配微信点击，不重做原来的无时间处理、分类、时间筛选与去重。已核对历史 2026-08-29 记录，无时间用查询上界占位并标来源是原有约定，不能仅据占位认定流程新出错；上一段整批审计中对此的归因过度。
- 已撤销新增强制标题门槛和批次清理失败的 fatal 中断，恢复原阅读器 readiness 与默认浏览器回退。扫描/筛选/去重循环及 OCR 分类与修复前 de5c9d6 逐字一致。
- 补齐漏接的 UI 适配：疑似图片打开后若没有独立图片窗口，检查内嵌文章区域并返回原 type_hint，接回原 image → article 流程，复用已打开的阅读栏而不重复点击卡片。Copy Link 点击前再次清空剪贴板，避免截图交互期间恢复旧值后被立即采纳。
- 这次是点击适配修正，尚未重新整批实机验收；19 unresolved、Nicky Case 候选缺席及整批收尾仍不能宣称已全部解决。已有运行证据和索引备份保持不变。

- 2026-09-13 用户整批运行 2026-09-13T14-10-11 暴露尚未解决的收集缺陷：8 个唯一 URL、19 unresolved（12 image + 7 article），最后 article_tab_not_closed。此前两篇验证不能证明整批可靠，当前不应视为全部修复完成。
- 审计确认：公众号卡片被 plain_text_block 误分图片；Send 按钮进入候选；Nicky Case 卡片在 page-5.png 可见却未生成候选；不同标题“30分钟PhD面试”与“游戏大厂老板…”被记为同 URL，后者随 URL 去重遗漏；8 个链接全部使用 range_until_fallback，无真实消息时间归属。
- 页面 10/11 可见 19:27，页面 12 可见 16:09，但只有页面 13 的 Yesterday 21:18 关联到 block 才触发停止。北京时间转 UTC 正确，缺陷在 timestamp-to-card 关联与无时间占位收录；range_coverage=complete 仅表示扫描触及旧消息，不表示提取完整。
- 本次 index-snapshot.jsonl 已备份进用户失败运行目录，保存原始 27 条记录；本轮只诊断，未重跑、未修复上述新发现、未覆盖历史结果。需用该次多页真实材料做回归，解决候选、时间归属、链接对应关系及整批清理。

- 2026-09-13 新版微信内嵌文章流程已修补：菜单固定边距定位；本机校准左侧聊天 735 pt / 全窗 1470×923 pt；逐篇保持阅读栏，批次结束用标签自身 × 统一关闭。原 scan/collect 命令自动读取 gitignored 的 local/ui-layout.json，两处运行目录均已配置；启动前须手动打开第一篇并保持布局。
- 实机连续提取 TRPG 与 Claude Science 两篇，得到两个不同真实 mp.weixin URL，逐篇 viewer_close_wait_ms=0。最后关闭标签的修正单独复用已打开文章验证，结果 status=closed / closed=2；after-cleanup.png 已确认文章栏消失且微信聊天主窗口保留。
- 全量测试 206 pass / 0 fail。验证产物位于 wechat-filehelper-macos-ingest/local/docked-verification/。本轮仅验证链接采集与关闭，没有批量扫描历史或新增 Web Clipper/摘要/PKM 写入。


- 2026-09-06 扫描 manifest 已确认时间线完整覆盖：15 页、14 次滚动、25 条唯一链接，`range_coverage=complete`、`termination_reason=reached_before_since`；其中 22 条公众号文章、3 条视频号，另有 2 条图片 OCR 和 4 条 unresolved 项。
- 图片 OCR 的 2 条内容已由扫描器写入 Obsidian `needs_review`；4 条 unresolved 没有可靠 URL，仍未擅自补全。
- 22 条公众号文章已通过 Web Clipper 写入 Obsidian `Clippings/WeChat/2026`。首轮并发运行曾产生 5 条 active-tab 错配假成功，已由 URL-to-tab 修复后的串行重跑纠正；5 个错配笔记已移至 `obsidian-web-clipper-ingest/local/quarantine/false-success/2026-09-06-concurrent-tab-mismatch/`，可恢复。
- 最终文章验收为 22/22：每条 `clipTarget.sourceUrl` 与请求 URL 一致，22 个笔记路径互不重复，文件均存在、非空并含对应源 URL。
- 原扫描命令列出的 3 个视频号短链已真实确认是同一个 3054.55 秒视频。第二次正式重跑完成 172/172 个本地 ASR 分片和一次 Codex 摘要；最终 manifest 为 `complete`，计数 `unique_videos=1 / duplicate_links=2 / written=1 / skipped=2 / failed=0`。
- 视频笔记已写入 `PlayWithExperiences/Clippings/2026-0831-九阴真经 武侠.md`：16,328 字语音证据生成 873 字摘要和 8 个要点；YAML/H1 语义标题仍为 `《九阴真经：武侠》`，源链接、类型、正文结构、无签名 URL 泄漏均已回读通过。

## 当前阶段

- 视频批处理现先解析全批身份并按内容指纹去重，再启动唯一视频重任务；终端会显示“3 个分享短链 → 1 个唯一视频”，重任务进度使用 `[video 1/1]`。
- 本机 ASR 现复用 V2T 的可恢复分片 worker，每个 20 秒分片在独立进程中执行并逐片留痕；带临时签名参数的封面 URL 不再写入任务状态。
- 视频修复提交 `a38176a`、`649641d`、`d3c2384`、`b8eee8b`、`572ff14` 均已推送；实现真源与 GitHub 运行副本已 fast-forward 到 `572ff14`。完整测试为 196 pass / 0 fail；真实长视频完成 172/172 worker 分片。
- `d3c2384` 按 V2T 标准顺序首次创建 recovery job，重试时复用已有 job；修复了只有音频超过 20 秒才出现的分片目录 `ENOENT`。
- 长简介语义标题会优先收束为最具体的 `《作品名》`；文件 basename 则由共享 portable naming 模块独立生成日期前缀与跨平台白名单结果。当前笔记已纠正为 `2026-0831-九阴真经 武侠.md`，PKM 提交 `c9a870b4` 已推送。
- Web Clipper 启动链路已修复：传入配置的 `chromePath`，移除会抑制扩展的 Playwright 默认参数，并按页面 URL 查询 tab ID，避免并发页面把剪藏目标写到别的 URL。
- 由于当前 Google Chrome 152 明确忽略 `--disable-extensions-except`，本机 `local/config.json` 暂使用已存在的 Chrome for Testing 151 缓存；没有下载新浏览器，也没有改用户 Chrome profile。
- TDD 回归与全量测试均通过：`npm test` 为 17 pass / 0 fail；真实批处理 manifest 为 `obsidian-web-clipper-ingest/local/runs/2026-09-06T07-26-52-414Z/manifest.json`，5 条修复重跑 manifest 为 `local/runs/2026-09-06T07-36-22-423Z/manifest.json`。
- 文章输入文件为 `obsidian-web-clipper-ingest/local/inputs/2026-09-06-filehelper-links.txt`，共 22 条唯一 `mp.weixin.qq.com/s/` URL。
- Auto Mover 当前关闭；本轮正确笔记均位于 `Clippings/WeChat/2026`，符合当前设置。

## 下一步

- 正常使用继续原 collect/scan 命令，先打开第一篇文章形成并排布局；保持大小和位置。改尺寸须重校准 local/ui-layout.json，尺寸/位置漂移、标题未确认或清理失败会显式报错。



- 相同时间范围再次运行时，确认一个 canonical 笔记与两个 `skipped_duplicate` 任务都直接复用，不再下载、转写或重复写笔记。
- 4 条 unresolved 项没有可靠目标地址，除非补充真实链接，否则保持未解决状态。
- 下次文章批处理需继续验收 `clipTarget.sourceUrl === requested URL`，不能只看 success 或笔记文件存在。

## 阻塞 / 待定

- 视频处理当前无已知阻塞；成功 manifest、canonical task、两个 alias task 和 PKM 笔记已经互相对齐。
- Chrome for Testing 缓存若后续被清理，当前本地配置将失效；需重新提供可用的 headed 浏览器路径或安装兼容的 Playwright 浏览器后再运行。
- 文章剪藏当前无已知阻塞；本轮只处理了公众号文章，未将视频号错误地交给 Web Clipper。
