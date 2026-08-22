# 微信视频号仍被跳过诊断

## 1312 根因确认

决策：無涘（本次先“看一下”，未授权修改处理逻辑） ｜ 记录：codex

### 结论

- 当前所有 macOS 采集入口都会把视频号标为 `video_channel` 并记录为 `skipped_card`；`collect` 没有视频后处理分支。
- 这不是近期回归。跳过规则自 2026-03-29 加入后未改，定向测试 39/39 通过，其中包含“视频号 URL 应被跳过”的显式用例。
- 2026-08-18 项目快照把 pending 队列、音频捕获、V2T ASR、摘要和 Obsidian 写回误记为已实现。仓库、Git 分支/stash/工作树及本机近期 Codex、Claude、DSH 会话中均无对应实现证据。
- 原始治理访谈的验收是“视频号只做到有记录，不承诺完整内容”。现有行为符合该草稿目标，但不符合無涘对“上次已尝试处理内容”的记忆/预期。

### 风险与未知

- 本工作副本没有今天真实扫描的 manifest，不能确认用户看到的具体卡片标题和运行来源；代码层根因已经确定。
- ProjectVision 仍是待無涘确认的 AI 草稿；是否升级视频号范围尚未决策。
- “没找到实现”经过仓库、全部 Git 状态与本机近期会话三条通道复核；不是仅凭一次空搜索得出的否定结论。

### 下一步

- 若無涘决定升级为内容处理，先做单卡最小验证：手动播放 → 捕获正确音频 → 完成一次本地转写。一次只验证这一条假设，不提前实现队列、自动播放、结束判断和完整写回。
- 若继续维持“只留记录”，应保留当前 `skipped_card`，并避免再用“已接入视频处理”描述现状。

### 产出

- 更新 `ProjectInfo/ProjectProgress.md`，纠正错误状态快照。
- 未修改任何采集或 Obsidian Clipper 代码。

原始对话：dialogues/2026-0822.md「1312 视频号仍被跳过诊断」

## 1355 技术方案审计完成，主线改为后台媒体处理

决策：無涘（明确视频处理不得按视频时长占用前台；最终产物契约待确认） ｜ 记录：Codex

### 结论

- Computer Use 不是完全不能控制微信：窗口、快捷键和键盘输入可用；但微信聊天正文是自绘/嵌入式界面，辅助功能树几乎不暴露内部控件，坐标操作也发生过误触。因此它不适合作为生产主控，现有 JXA/OCR 查看器生命周期仍应作为可预测的前台扫描方式。
- 微信安全退出与 Computer Use 只有时间相关性，没有因果证据。本机统一日志没有给出退出原因；不得把“按回车后弹窗”写成“自动化导致退出”。
- 本机微信 4.1.11 明确包含“AI总结（由元宝提供）”以及 `yuanbao_xfile`、`yuanbao_xweb` 开关，须知对象写为“文件或文章”；未发现视频号完整转写的稳定客户端契约。腾讯高管公开发言确认公众号和视频号评论区可 `@元宝` 总结、问答，但这是用户可见的外部评论动作，不作为默认自动化。
- 腾讯云 MPS 有正式异步 ASR、大模型视频摘要和分段摘要 API，可后台运行，但需要云凭据、计费和媒体 URL/COS；它不能单独解决从微信卡片取得媒体的问题。
- GitHub 多关键词搜索与代码核验没有发现同时满足“成熟、macOS、无完整播放、完整逐字稿、可批量接入”的一体化成品。`wechat-video-subtitle` 已实现普通视频的元宝后台解析、下载、FFmpeg 分段和 ASR，证明架构可行，但项目很新且 macOS 标注实验性；`ltaoo/wx_channels_download` 是当前最成熟的 macOS 下载底座，带本地 API/MCP，但需代理/根证书并存在近期客户端兼容问题；`nobiyou/wx_channel` 只支持 Windows；`scribe-transcribe` 当前实际只实现下载，没有转写。
- 推荐主线改为：现有扫描器短时取得 `weixin.qq.com/sph/...` 并立即关闭 viewer → 独立元宝浏览器登录态在腾讯域内后台解析媒体 → 下载/解密并强校验 → 本机 V2T 完整转写 → 摘要、要点和逐字稿写回 Obsidian。原生元宝总结可先单卡验证，若产物足够再作为捷径；MITM、ScreenCaptureKit 和前台完整播放均降为显式后备，不得静默启用。

### 风险与未知

- 元宝解析端点属于未公开 Web 接口；虽有多个独立开源实现和当前源码证据，仍存在接口漂移风险，必须有明确错误状态与后备路径。
- 私聊转发视频给元宝是否返回完整逐字稿、能否稳定复制/导出、是否能可靠关联源卡片尚未验证。
- `ltaoo` 最新版本在微信 4.1.12 有内嵌窗口/检测问题；本机 4.1.11 不能据此判定失败，也不能提前承诺稳定。
- 最终产物是否必须包含完整逐字稿仍会改变主路径：若只需高质量摘要，原生元宝可能省掉下载与本地 ASR；若需完整信息，本地 V2T 仍是主契约。

### 下一步

- 由無涘确认最终笔记是否必须包含完整逐字稿；建议默认“是”。
- 微信恢复登录后只用一张普通视频号卡片验证原生元宝产物，再单独验证分享链接后台解析，避免一次测试混合多个假设。
- 通过后提交分段设计与失败状态表，获批准再按 TDD 实施。

原始对话：dialogues/2026-0822.md「1355 视频号技术方案审计」

## 1549 视频号提链真实验收完成，后台解析停在一次登录

决策：無涘（视频号必须全自动、前台占用不随时长增长；最终产物暂定「链接 + 高质量摘要 + 要点」；不采用元宝总结） ｜ 记录：Codex

### 结论

- 视频号已进入现有文章卡片的「识别 → 自动点开 → 复制链接 → 自动关闭」链路；不是新增一套完整播放自动化。
- 微信 4.1.11 主窗口 `sharingState=0` 时，使用微信自带截图蒙层可取得画面；双 `Esc` 清理避免截图层拦截后续点击。OCR-only 候选固定使用所属右侧簇，并在文字底部点击未打开 viewer 时向上重试一次。
- 视频号 viewer 能通过顶部 15% 的含噪声“视频号”OCR 识别；底部分享箭头可打开含“复制链接”的菜单。菜单截图必须局限于 viewer 窗口，不能用多显示器整屏 OCR 坐标回点。
- 真实单卡运行 `local/runs/2026-08-22T07-34-03` 已满足三项判据：索引新增 1 条 `/sph/`、manifest `share_cards_resolved=1` 且 unresolved=0、运行后微信只剩一个主窗口。前台只占用约数秒，不等待视频播完。
- 后台内容链仍未完成。公开 `/sph/` 页面可匿名访问，但视频号官方 `get_feed_info` 在无身份时返回 401 `permission verification failed`；补齐官方 `_rid/_pageUrl` 参数且确认分享页无 cookie 后结果不变。
- 本机缓存替代路线已查尽并强校验：近期 12 条 `finder.video.qq.com` 请求全部由服务器确认是 JPEG 封面，xworker IndexedDB 对 `videoUrl`/MP4/M3U8 为 0 命中；不能把封面、加密 blob 或域名命中冒充媒体。
- `jianminggan/wechat-video-subtitle` 的源码路线与信任边界相符：元宝登录态仅把 `/sph/` 换成 `token + eid`，媒体仍来自视频号官方接口；摘要与要点由我们自己的后续链路生成。Chrome 与 Codex 内置浏览器当前都未登录元宝。
- 本机 V2T 有可复用 ASR provider，但没有独立媒体文件转写 CLI；需在媒体解析验证后做薄适配，不能提前写成已接通。

### 风险与未知

- 元宝短链解析是未公开 Web 接口，可能漂移；实现必须分别记录 `auth_required`、`parse_rejected`、`media_missing`，不得以空值磨平。
- 当前尚未获授权打开元宝登录二维码；登录后的 `/sph/ → token/eid → media URL` 仍需单卡验证。
- 全量扫描在 OCR-only 页面上的不同卡片布局仍需更多实卡样本；本次只证明当前视频号卡片与窗口形态。
- 完整测试集中的 query 标题断言另有两项既有失败（“待确认外链”与“待确认项”差异），与本次 UI/视频号改动无关；不得写成全套全绿。

### 下一步

- 经無涘确认后打开独立元宝登录页，由用户完成一次微信扫码；不向元宝发送总结请求或聊天消息。
- 登录后先只验证媒体解析与 HTTP 类型/大小/Range，不下载整段、不同时实现转写和写回。
- 媒体验证通过后，再按 TDD 实现后台状态机、V2T 文件转写薄入口、我们自己的摘要/要点与 Obsidian 写回。

### 产出

- `wechat-filehelper-macos-ingest/scripts/lib/applescript.js`
- `wechat-filehelper-macos-ingest/scripts/lib/ui.js`
- `wechat-filehelper-macos-ingest/test/applescript.test.js`
- `wechat-filehelper-macos-ingest/test/ui.test.js`
- `wechat-filehelper-macos-ingest/SKILL.md`
- `ProjectInfo/ProjectProgress.md`

原始对话：dialogues/2026-0822.md「1549 视频号提链真实验收与后台解析边界」

## 1315 全自动提链已实现，后台解析需登录元宝

决策：無涘 ｜ 记录：codex（自动）｜ session 01a027da-4e12-76c3-a39e-34d494386966

诊断确认视频号卡片被跳过系代码自 3 月起按 video_channel 规则截留，并非回归。完成从自动点开卡片到提取公开 /sph/ 链接、自动关闭并写入索引的全自动化链路，真实运行成功（1 resolved，0 unresolved）。后台媒体解析因腾讯官方接口需登录态而阻塞，匿名路径、缓存提取均未获完整视频地址。用户授权使用元宝网页仅作为短链解析凭据，不调用元宝总结。下一步将利用该登录态通过官方 API 获取媒体，再经本机 V2T 转写并生成自有摘要写入 Obsidian。

原始对话：dialogues/2026-0822.md

## 1642 元宝解析、本机转写、自有摘要与 Obsidian 全链路完成

决策：無涘（允许登录元宝；最终产物为原始链接 + 高质量摘要 + 要点；不采用元宝总结） ｜ 记录：Codex

### 结论

- 無涘完成独立元宝 profile 的微信扫码登录。强验真结果为：元宝解析 HTTP 200 / code 0，视频号官方 feed HTTP 201 / errCode 0，媒体 Range 返回 HTTP 206 `video/mp4`；没有把界面登录假象当作成功。
- 正式实现 `video-channel-resolver / runtime / pipeline / batch`：元宝只换取临时 `token + eid`，官方 feed 提供媒体；状态机逐步持久化，失败记录 `failed_stage + error_code` 并追加 failure log。
- 本机真实 V2T 探针处理同一条 328.21 秒视频：下载 11,475,719 字节，Qwen3-ASR 完成 19/19 分片并产出 1,295 字逐字稿。探针结束后临时媒体与逐字稿已删除。
- 完整端到端运行 `local/video-channel/runs/2026-08-22T08-34-38-009Z/manifest.json`：`selected=1 / written=1 / failed=0`；Codex 固定 JSON Schema 输出 601 字摘要和 8 条具体要点，Obsidian 回读验证源链接、两类正文区块与临时文件清理均通过。
- 幂等复跑在 1 秒内返回 `skipped=1`，未重复下载、转写或写笔记。
- `collect` 已默认接入后台视频处理；query 将 `/sph/` 单列为「视频号（后台处理）」，避免误交文章 Web Clipper。显式 `--skip-videos` 才跳过。
- 全模块最终新鲜测试 126/126 通过。此前两项 query 失败来自测试硬编码另一个 checkout，改为相对当前测试文件寻址后全绿；新增 Obsidian 目标缺失分支保证 manifest 不会停在 `running`。

### 风险与边界

- 元宝解析是未公开 Web 接口，可能漂移；已区分 `auth_required / parse_rejected / feed_rejected / media_missing` 等错误，不做空结果兜底。
- 本机 V2T 顺序转写不会抢占桌面，但 5 分 28 秒样本约需数分钟计算；真实多视频批次尚未做耐久验收。
- Codex 摘要会把临时逐字稿交给用户已登录的 Codex 服务；元宝只看到原始公开分享链接。
- 默认不保留 MP4、WAV 或逐字稿；最终笔记没有逐字稿章节。

### 产出

- `wechat-filehelper-macos-ingest/scripts/process-video-channels.js`
- `wechat-filehelper-macos-ingest/scripts/lib/video-channel-{resolver,runtime,pipeline,batch}.js`
- `wechat-filehelper-macos-ingest/references/video-summary.schema.json`
- 4 份视频号后台处理测试与 query 路由回归测试
- `wechat-filehelper-macos-ingest/SKILL.md`
- `ProjectInfo/ProjectProgress.md`
- `ProjectInfo/roadmap.md`

原始对话：dialogues/2026-0822.md「1607 视频号元宝登录与后台全链路验收」

## 1653 今日两条视频号处理状态复核

决策：無涘（要求核对今天批次中的两条视频号是否都已处理） ｜ 记录：Codex

### 结论

- 没有两条都处理。今天的微信截图中可见两张视频号卡片，但 `local/runs/2026-08-22T07-34-03/artifacts/candidates.json` 只有一个候选，`links.jsonl` 只有一个 `/sph/`，视频任务目录也只有一个 `written` task。
- 已处理的是上方“项目发展规划／大学生创新创业大赛”视频，已有摘要和 8 条要点的 Obsidian 笔记。
- 下方只露出部分的“OCR+翻译／粘贴神器”视频没有取得分享链接，因此没有进入解析、下载、转写或摘要阶段；Clippings 库中也没有匹配笔记。
- 根因位于前端候选发现：部分可见的第二张卡没有被产生成独立候选。后台处理本身没有收到第二条任务，所以 `failed=0` 不能解释为两条都成功。

### 风险与下一步

- 当前 `share_cards_seen` 是画面观测数，不等于唯一任务数；若只看 manifest 的 `failed=0` 会形成假成功。
- 下一步应先为“同屏一张完整卡 + 一张部分可见卡”建立回归样本，再修复滚动/候选去重逻辑，并用今天两张真实卡补跑验收。

原始对话：dialogues/2026-0822.md「1653 两条视频号处理状态复核」
