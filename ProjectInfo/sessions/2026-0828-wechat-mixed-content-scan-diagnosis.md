# 微信混合内容扫描漏收诊断

## 2358 五类故障根因确认

决策：無涘（本次要求检查，未授权修改采集逻辑） ｜ 记录：Codex

### 结论

- 本次运行使用 GitHub 旧副本 `5126e6f`，而 Director 当前工作副本为 `b7b5ade`；两份历史分叉。旧副本没有现行视频号 `/sph/` Copy Link 与后台处理链。
- `candidates.json` 的 80 条结果为 24 resolved、4 unresolved、14 skipped、38 duplicate。多数 duplicate 是滚动重叠，但至少“南洋理工… / Friend Slop… / 众神的权柄（上）”三篇不同文章被旧版 OCR 指纹别名误伤，未被点击。
- 图文内容被拆成两个 OCR 指纹并共尝试 4 次；viewer 实际打开，但旧版要求公众号文章元数据壳，最终均为 `viewer_not_ready`，没有执行菜单 Copy Link。
- 视频号打开后被判为 `video_channel`，旧版通用 extraction-skipped 分支只写 `skipped_card`，没有生成 pending 或 `/sph/`。7 条记录包含跨页和簇拆分重复。
- 图片中的文字已经被 Vision OCR 读到，但只作为 `plain_text_block / weak_ocr_card` 写入跳过记录；正式图片内容链不存在。
- 两个裸链接均在 OCR JSON 中：单行 URL 因 cluster 少于两行被丢；换行 URL 因文本左缘小于整屏右区硬阈值被丢。空剪贴板兜底没有恢复它们。
- 当前新版已覆盖视频号并放宽 viewer ready，但真实 OCR 离线回放仍漏两条裸链，图片链仍缺失，前 10 字去重仍有上下篇碰撞风险。

### 验证

- 旧副本 `node --test test/ui.test.js`：91 pass / 0 fail。
- 当前副本 `node --test test/ui.test.js`：48 pass / 0 fail。
- 用当前 `buildUiSnapshot` 回放本次 page 15 与 page 18 OCR：`directUrlEntries` 均为 0。
- 未触发新一轮微信扫描，未修改生产代码。

### 风险与下一步

- 测试全绿是覆盖缺口，不是采集完整性的判据；必须把本次 artifacts 转成红灯回归样本。
- 若授权修复，先收束唯一真源，再将去重、图文、视频、图片、裸链接拆成五个可独立归因的改动；最后以逐消息对表做一次真实批次验收。
- 图片 OCR 需定义正式记录与失败状态，不能继续以 skipped raw text 代替已收录内容。

### 产出

- 更新 `ProjectInfo/ProjectProgress.md`。
- 新增本会话 dialogues 与 sessions 留痕。
- 未修改采集、视频处理或 Obsidian 代码。

原始对话：dialogues/2026-0828.md「2358 微信混合内容扫描漏收诊断」

## 0001 微信混合内容采集故障诊断与修复实施

决策：無涘 ｜ 记录：Codex ｜ session 01a04911-d358-7e61-90e5-0a13d7881c0e

### 结论

- 分叉历史已在 `1310a87` 收束，Director 真源的现行视频号架构保留，旧 GitHub 历史成为祖先；功能与文档交付至 `331e39b` 并以 fast-forward 推送 GitHub。
- 五类缺陷均已实现修复：保守卡片去重；图文 partial viewer 继续 Copy Link；视频号专用 `/sph/` 提链；图片 viewer 本地 OCR 与 Obsidian 写回；单行及跨行裸链接恢复。
- 图片内容以 `image_ocr` 独立建模，高置信结果写入 PKM，低置信结果 `needs_review`；提链、viewer、OCR、写回失败均以 `unresolved_item` 显式留痕。
- 查询新增 `image_contents / unresolved_items`；manifest 建立按类型的互斥结果账本，不守恒时不得宣称扫描成功。

### 验证

- `git diff --check` 与全部 JS 语法检查通过。
- `npm test`：154 pass / 0 fail。
- 2026-08-28 真实产物 page 15–20 离线回放：5 个预期直链页面全部恢复；6 页都有图片候选；第 19 页相同图片只保留一个候选。
- 本轮没有执行新的微信现场扫描，因此现场验收状态明确为“待运行”，不以离线结果替代。

### 风险与下一步

- 下次正常采集应做一次小批次逐类型对表，同时核验 manifest 守恒、查询分组和 Obsidian 图片笔记回读。
- 本场经历上下文压缩，早期回合以 dialogues 原文为准。

### 产出

- 设计：`docs/superpowers/specs/2026-08-29-wechat-mixed-content-ingest-design.md`。
- 计划：`docs/superpowers/plans/2026-08-29-wechat-mixed-content-ingest.md`。
- 核心提交：`9f24fc2`、`4517e9c`、`11aae3f`、`1480456`、`331e39b`。

原始对话：dialogues/2026-0829.md「0001 微信混合内容采集故障诊断与修复」

## 0157 多屏菜单坐标回归修复与现场验收

决策：無涘 ｜ 记录：Codex ｜ session 01a04911-d358-7e61-90e5-0a13d7881c0e

### 结论

- 新运行确实打开了四篇文章但一次都没有展开右上角三点；失败发生在菜单定位，不是 Copy Link 后的入库阶段。
- 根因是文章 viewer 使用整屏 OCR 中的元宝摘要文字反推三点，再把跨显示器、不同缩放倍率的整屏图像坐标映射回逻辑坐标；本次实际布局把 5 个探针全部夹到空白点 `(500,41)`。
- 最小修复删除不可靠的 OCR 锚点分支：三点探针只相对 viewer 矩形计算；菜单展开后也只截取 viewer 矩形做 OCR，再把 Copy Link 坐标映射回同一矩形。
- 该坏分支早于本轮五类修复，旧提交 `5126e6f` 已存在；但此前交付没有做新版本现场验收，因而错误地把“会尝试 Copy Link”当成“可以拿到链接”。

### 验证

- 新增真实多屏几何回归：viewer `{0,33,735,922}`、整屏 `{−546,−1440,2560,2396}`；红灯时 5 个点击均为 `(500,41)`，绿灯后落到 viewer 右上角 `(702–713,53–63)`。
- 菜单局部截图为 `1470×1844`，OCR 找到 `Copy Link`，不再使用 `4028×1912` 的跨屏截图映射点击。
- 完整检查：`git diff --check`、全部 JS 语法检查通过；`npm test` 为 155 pass / 0 fail。
- 单候选现场扫描 `local/runs/2026-08-28T18-09-08/manifest.json`：首探针 `(702,53)` 展开菜单，写入真实公众号链接 `https://mp.weixin.qq.com/s/EX7dzr4PLRoYtYE9ITFfmw`；article `seen=1 / recorded=1 / unresolved=0`，未使用浏览器兜底。

### 风险与下一步

- 本场只用一篇普通文章做了现场验收；裸链接、视频号和图片仍由自动测试及旧真实产物离线回放覆盖，不将其表述成新版本现场通过。
- 本场经历上下文压缩，早期回合以 dialogues 原文为准。

### 产出

- 修复提交：`1457386`。
- 修改：`wechat-filehelper-macos-ingest/scripts/lib/ui.js`、`wechat-filehelper-macos-ingest/test/ui.test.js`。

原始对话：dialogues/2026-0829.md「0001 微信混合内容采集故障诊断与修复」

## 0342 整批时间线、图片与视频运行时修复

决策：無涘 ｜ 记录：Codex ｜ session 01a04911-d358-7e61-90e5-0a13d7881c0e

### 结论

- 2026-08-28 23:00–23:59 整批运行在第 15 次滚动提前停止，根因是 `Yesterday 23:38` 相对查询上界而非实际扫描时刻解析，错误落到前一天；现改为实际扫描时刻解析，只有界面无时间项才以查询上界占位并写明来源。
- 两个“梁文锋”图片 OCR 产物实际是公众号 viewer 的 `Loading / Summary Provided by yuanbao` 顶栏，属于 OCR 分类误判；现将顶栏降级为类型提示，只有受支持公众号 URL 能最终确认文章，安全探测失败则保留图片 OCR。
- 如果 Copy Link 已拿到 URL 但 viewer 恢复失败，链接与恢复故障会同时保留并停扫；无 URL 的恢复失败不允许伪装成图片成功。
- 图片/视频写回失败源于 macOS Obsidian 解析器间接导入兄弟项目 Playwright 且仅覆盖 Windows vault 路径；现由本包直接解析 macOS vault，Playwright 固定为本包依赖。
- 旧图片笔记按稳定身份和 OCR 正文哈希兼容重扫；旧索引时间来源未知会显式显示；图片重路由数量已进入 manifest。

### 验证

- 各修复均先用失败回归复现，再转绿；最终 `npm test` 为 178 pass / 0 fail。
- 全部 `scripts/` 与 `test/` JavaScript 通过 `node --check`；`git diff --check` 通过。
- `npm ci --offline --ignore-scripts` 成功；本包 Playwright 启动无网络空白页并返回 `runtime-ok`。
- 实际 Obsidian 解析器返回 `/Users/haodong/Documents/GitHub/PKM/PlayWithExperiences/Clippings`。
- 独立代码复核经过两轮：首轮发现 5 项生产正确性问题，修复后又发现 viewer 恢复失败被 OCR 回退吞掉；最终复核 verdict 为 Ready，无 Critical/Important。

### 风险与下一步

- 旧运行产物不会被代码修复追溯改写；需在下次正常 `--reindex` 中生成新索引与图片笔记。
- 本场未执行两条视频号的真实后台批处理，不将 Playwright/目标目录边界验证表述为视频端到端成功。
- 本场经历上下文压缩，早期回合以 dialogues 原文为准。

### 产出

- 实现提交：`cb1f6ac`、`acb4343`。
- 主要修改：时间来源、图片/文章类型确认、图片笔记兼容、macOS vault、Playwright 隔离、恢复失败审计与 manifest 统计。

原始对话：dialogues/2026-0829.md「0342 整批运行时间线与图片处理修复」

## 1130 新批次假成功修复与时间线覆盖核实

决策：無涘（沿用“全部修复、直接实现并同步 GitHub”的既定授权） ｜ 记录：Codex ｜ session 01a049ca-4030-75e0-bbbb-80faba453e51

### 结论

- 新批次滚动 20 次、取得 36 条链接；第 20 页真实出现 `Yesterday 21:25`，早于请求下界 23:00，因此时间线这次实际完整跑过。用户之所以无法判断，是旧 manifest 只写 `max_scrolls`，没有保存真实终止原因。
- 3 条图片内容中，Apple 与 Sac 截图正文有效；第三张截图仍停在空白 `Loading....`，OCR 只得到 `•••6upeoT`，却被作为 `needs_review` 写入 PKM。根因是图片链只等 viewer 窗口出现，没有等待 viewer 内容加载。
- 直接链接中的 `https://en.itu/` 来自独立页 OCR 片段 `https://en.itu.`；同页候选比较无法利用上一页的完整 `en.itu.dk` URL，且行尾句点被清洗后失去截断信号。
- 8 条视频号链接均已取得；后台全部失败是元宝独立浏览器 profile 返回 HTTP 401。微信重新登录与该认证无关，旧批处理还会对余下 7 条重复同一必败请求。

### 修复

- 图片 viewer 最多重复截图/OCR 5 次，只有工具栏下方出现正文才发布；顶部工具栏 OCR 全部剔除，持续空白会显式报 `image_ocr_empty`。
- OCR 独立 URL 行若以句点结尾，按 `terminal_period` 进入 uncertain，不再进入已确认链接。
- UI 扫描新增页数、实际滚动次数、最早可见时间、终止原因与 `complete / incomplete / unverified` 覆盖状态；终端同步显示结论。
- 视频批处理首个 `auth_required` 后熔断，只把已尝试项计为 failed，其余计为 `not_attempted`，manifest 状态为 `blocked_auth` 并给出恢复命令。
- 已将唯一确认的 Loading 假笔记移出 Obsidian Clippings，保存在本地 quarantine；两条真实图片笔记未动。

### 验证

- 四项行为均先加入失败回归并观察红灯，再修改生产代码转绿。
- 使用本次 page 20 原始 OCR 回放，新结果仅产生 `https://en.itu/ / uncertain / terminal_period`。
- `npm test`：182 pass / 0 fail；全部 JS 语法检查和 `git diff --check` 通过。
- 未重跑微信 UI 或 8 条视频后台任务；视频仍需先完成元宝独立认证，不能把代码熔断修复表述为视频处理成功。

### 产出

- 代码提交：`b8ac875`。
- 修改：UI 图片等待与时间线审计、scan manifest、视频认证熔断及对应测试。

原始对话：dialogues/2026-0829.md「1130 新批次假成功修复与时间线覆盖核实」

## 1317 视频号真实处理、视觉 OCR 与内容级去重

决策：無涘（完成元宝登录后明确要求直接处理） ｜ 记录：Codex

### 结论

- 元宝认证已恢复，8 条 `/sph/` 均能解析和下载；首次批处理的新失败是 `asr_runtime_missing`。根因不是缺模型，而是 GitHub 副本只推导 `/Users/haodong/Documents/GitHub/V2T`，实际 V2T 位于 Director 工作区 `/Users/haodong/Documents/AI/Codex/V2T`。
- 8 个分享短链实际只对应 3 个视频。同一卡片内多个 OCR 点击点会生成不同 `/sph/`，但解析后的作者、完整描述和发布时间一致；现以该稳定身份去重，首篇写入后其余任务明确记为 `skipped_duplicate` 并指向 canonical 笔记。
- 14 秒戒指视频的本机 ASR 只有“系统。”；旧管线因“非空”而生成了一篇内容不足的假成功笔记。抽帧实验验证 Vision OCR 能还原“毛发收集 → 碳化提纯 → 培育组装 → 取出钻石原坯 → 激光切割 → 人工精磨 → 成品”，因此正式实现只在语音信息不足时启用最多 10 帧视觉 OCR。
- Swift Vision helper 改为编译到 gitignored 本地运行目录并复用，避免逐帧 `swift` 解释执行在 60 秒硬超时。摘要提示会区分 ASR 与画面 OCR，不把标题扩写成内容证据；视频标题只保留描述首段，避免 hashtags 变成 Markdown 标题。

### 真实结果

- 最终 manifest：`local/video-channel/runs/2026-08-29T04-55-14-837Z/manifest.json`，`selected=8 / written=3 / skipped=5 / failed=0 / not_attempted=0`，状态 `complete`。
- 班尼特·福迪视频：`speech_asr`，1182 字证据、526 字摘要、7 个要点。
- 头发钻石视频：`visual_ocr`，3 字低信息语音被舍弃，10 帧生成 254 字视觉证据、194 字摘要、6 个要点。
- Token 工具视频：`speech_asr`，116 字证据、279 字摘要、6 个要点；摘要显式保留额度说法不一致和项目名疑似 ASR 错误的不确定性。
- 三篇 PKM 文件逐篇回读，来源链接、标题、摘要和要点均存在；不含“系统。”或“无法据此生成可靠摘要”的探针假成功措辞。探针笔记保存在 `local/video-channel/quarantine/false-success/`，可恢复但不再位于 Clippings。

### 验证与产出

- 所有行为先观察失败回归，再以最小实现转绿；最终 `npm test` 为 188 pass / 0 fail，全部 JavaScript 通过 `node --check`，`git diff --check` 通过。
- 代码提交：`bba46be`；合并 Director 侧两条既有 Web Clipper 留痕后，两份本地 AI-Clippings 与 GitHub 统一到 `b659cdf`。
- 本次是实现缺陷修复，没有新增产品决策，因此不追加 roadmap。

原始对话：dialogues/2026-0829.md「1317 视频号真实处理与视觉 OCR」
