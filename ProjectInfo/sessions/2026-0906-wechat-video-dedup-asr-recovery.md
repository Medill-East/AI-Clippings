# 微信视频号重复短链与长视频 ASR 恢复

*更新于 2026-09-06 15:41 · 记录者 Codex*

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

