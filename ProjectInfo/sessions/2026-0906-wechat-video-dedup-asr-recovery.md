# 微信视频号重复短链与长视频 ASR 恢复

*更新于 2026-09-06 16:28 · 记录者 Codex*

## 1541 三短链去重与 SIGKILL 修复

反馈：無涘 ｜ 记录：Codex

### 结论

- 2026-09-06 扫描取得的三个视频号短链不是三条视频。三个链接解析后的内容指纹均为 `4e9fa95311632632c272604780da1ec5c5a8801f214f7a4c129af3ccad5ae3d8`，实际只有一个由“游戏葡萄”发布的《九阴真经：武侠》访谈视频。
- 旧批处理按短链串行执行“解析 → 下载 → 转写”，因此第一条 3054.55 秒视频在 `ASR 50/172` 被杀时，另外两个别名尚未解析，进度总数错误地显示为 3。
- 已改成“先解析所有未完成短链 → 按内容指纹分组 → 每个唯一视频只启动一个重任务”。manifest 保留 `counts.selected` 表示短链数，新增 `unique_videos`、`duplicate_links` 和 `identity_failed_links`；终端进度以唯一视频数为分母。
- ASR 不再让批处理主进程直接加载 V2T 原生识别器，而是复用 V2T 的 `RecoverableAsrTranscriber` 与逐分片 worker；分片完成结果可在中断后恢复，worker 退出时释放原生模型进程资源。
- 带临时签名参数的 `cover_url` 不再进入任务状态文件。

### 根因证据

- 已确认：旧 manifest 为 `running` 且结果为空；canonical 任务停在 `transcribing`；媒体为 151,861,509 bytes、时长 3054.552327 秒；shell 最后输出 `killed`。
- 已确认：V2T 以 20 秒切片生成 172 片，旧路径在主 Node 进程内逐片创建原生 recognizer；当前 `sherpa-onnx-node` 包没有供现有可选清理调用使用的 `free` 方法。
- 推断：原生对象不能及时释放是本次内存增长和 SIGKILL 的最可信解释；没有取得把具体 PID 与 macOS 内存终止事件直接绑定的系统日志，因此不把 OS 杀进程原因写成百分之百已证实。

### 验证

- TDD 红证据：旧批次序列为 `resolve:Alias1 → download → resolve:Alias2`，未先完成身份去重。
- TDD 绿证据：三个别名先全部解析，只执行一次 download、transcribe 和 summarize；唯一任务事件分母为 1。
- `npm test --prefix wechat-filehelper-macos-ingest`：190 pass / 0 fail。
- 所有改动 JavaScript 通过 `node --check`，`git diff --check` 通过。
- 真实 V2T 编译产物探针：单个 3 秒音频分片完成 `worker_progress=["1/1"]`，得到 15 字转写，退出码 0。

### 风险与下一步

- 完整 50 分 54 秒真实视频尚未重跑，所以“172 片全部完成并写入 PKM”仍是待验收项，不得标成已完成。
- 如继续，应在确认本次外部解析和 Codex 摘要调用后，仅重跑 2026-09-06 这一视频批次；验收终端先显示 `3 → 1`，最终应只有一个 canonical 视频重任务和两个 `skipped_duplicate` 链接结果。
- 旧运行的本地 manifest/task 已显式改为 `interrupted` 与 `process_sigkill_observed`，媒体和 WAV 保留，可恢复；它们均在 gitignored 本地状态中，不进入仓库提交。

### 产出

- `a38176a` — `fix: dedupe video aliases before recoverable ASR`
- `649641d` — `fix: keep signed cover URLs out of video tasks`

原始对话：dialogues/2026-0906.md「1541 视频号重复短链与长视频中断」

## 1553 首次正式重跑暴露 recovery 初始化缺口

授权：無涘（确认重跑一个唯一视频） ｜ 记录：Codex

### 运行结果

- 命令按同一时间范围选中 3 个短链，身份预解析正确收束为 1 个唯一视频、2 个重复短链；终端正确显示 `[video 1/1]`。
- canonical 视频下载 151,861,509 bytes 后，在转写阶段以 `ENOENT` 失败。manifest 为 `completed_with_failures`，计数 `written=0 / failed=1 / not_attempted=2`；Codex 摘要没有被调用。
- 失败 manifest：`wechat-filehelper-macos-ingest/local/video-channel/runs/2026-09-06T07-47-49-921Z/manifest.json`。

### 新根因与修复

- V2T 的 `splitWavForLocalSherpa()` 只在音频超过 20 秒时向传入的 `chunksDir` 写文件；它不自行创建目录，而标准调用方会先通过 `VoiceInputRecoveryStore.createJob()` 建立 recovery job。
- 此前实现直接构造 `RecoverableAsrTranscriber`，遗漏 `createJob()`。3 秒探针走单分片返回原 WAV，不写 chunk，因此产生假阴性；50 分钟音频写第一片时才暴露 `ENOENT`。
- 修复后首次运行先 `createJob`，已有 recovery job 则 `loadJob` 并复用 partial chunks，不会重置已完成进度。

### 验证与状态

- 两个新回归测试均经历红绿：首次建 job；已有 job 不调用 `createJob` 且继续使用原 recovery audio/partial 路径。
- 21 秒本地合成 WAV 真实跨过 20 秒边界，两个 V2T worker 完成 `1/2`、`2/2`，退出码 0。
- 全量 `wechat-filehelper-macos-ingest` 测试：191 pass / 0 fail；修复提交 `d3c2384` 已推送并同步两份本地副本。
- 首次正式重跑的失败清理已删除媒体和 WAV。第二次正式运行需要重新解析 3 个短链、重新下载约 152 MB、执行 172 个本地 ASR 分片，并在成功后调用最多 1 次 Codex 摘要；零重试。该范围超过此前“一次下载”确认，等待無涘重新确认。

原始对话：dialogues/2026-0906.md「1553 首次重跑与长音频边界修复」

## 1628 第二次正式重跑完成并收束标题

授权：無涘（确认第二次重跑） ｜ 记录：Codex

### 完成结果

- 成功 manifest：`wechat-filehelper-macos-ingest/local/video-channel/runs/2026-09-06T07-55-51-264Z/manifest.json`，状态 `complete`。
- 守恒结果为 `selected=3 / unique_videos=1 / duplicate_links=2 / written=1 / skipped=2 / failed=0 / not_attempted=0`；两个 alias task 均为 `skipped_duplicate`，且 `duplicate_of_task_id` 指向唯一 canonical task `fb356e1bd25c6c7e`。
- 50 分 54 秒媒体完整完成 172/172 个本地 worker 分片，得到 `evidence_type=speech_asr`、16,328 字语音证据；一次 Codex 摘要生成 873 字摘要和 8 个关键要点。
- 最终笔记为 `PlayWithExperiences/Clippings/《九阴真经：武侠》.md`。回读验证文件非空、含 canonical 源链接、`video-channel` 类型、摘要和 8 个要点，且不含临时 token、签名媒体地址或逐字稿正文。
- 媒体、WAV、逐字稿与 recovery 分片均已清理；任务目录仅保留状态文件。

### 标题收束

- 运行初产物直接把长简介截到 160 字，标题和文件名在句中断裂，不满足 PKM 可用性。
- 新回归测试先复现该结果；最小修复规定仅当简介超过 80 字时，优先选择其中最长、最具体的 `《作品名》`，无作品名才退回首句或 80 字截断。当前标题由长简介收束为 `《九阴真经：武侠》`。
- 标题修复后全量测试为 192 pass / 0 fail；AI-Clippings 提交 `b8eee8b`、PKM 笔记提交 `7ed56493` 均已推送。

### 当前状态

- 本轮视频处理无剩余阻塞；重复运行相同时间范围应直接复用 canonical 笔记并计入 skipped，不再下载或转写。

原始对话：dialogues/2026-0906.md「1628 视频号第二次重跑完成」
