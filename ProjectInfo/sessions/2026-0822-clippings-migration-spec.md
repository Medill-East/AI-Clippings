# clippings-migration-spec

> 按主题一份，追加不覆盖；同一场会话的节就地更新。

## 1404 迁移模块红绿迭代与安全架构修复

决策：無涘 ｜ 记录：codex（自动）｜ session 01a02955-53b2-7500-9650-3e3efd9d826b

本轮在 clippings-migration 三文件内完成多轮 TDD 迭代与安全加固。先后提交：①初始实现（19/19）；②修复 bare YAML scalar、probe 注入与并发清理（36/36）；③围栏内假 H1 保留（40/40）；④计划层 ownership-safe 重构（57/57）；⑤race 测试补齐（64/64）；⑥引入私有事务目录+hardlink 无覆盖发布+recoveryPath，解决 target/task/unlink 并发窗口，70/70；⑦pre-commit/committed 两阶段边界修复 in-place 目录泄漏，72/72；⑧video-channel 类型删除紧邻 tag 行，77/77；⑨收紧为旧 title hashtag 序列精确比对，支持 duplicate type 错误码，83/83。全程未触碰真实 PKM 或 video task，工作树干净。

原始对话：dialogues/2026-0823.md

## 1406 迁移脚本多轮只读审查与闭环

决策：無涘 ｜ 记录：codex（自动）｜ session 01a0296e-f00c-7373-8a75-4a5bd33f0238

对 clippings-migration 脚本进行多轮只读生产质量审查，覆盖 filesystem 注入、ownership race、回滚安全性和内容解析。初始版本存在 Critical 问题：大小写/Unicode 等价路径会错误删除唯一 note 并假成功；回滚未验证目标所有权；无 task 时误认异源 base 为已迁移。经过 `ebea994..100df00` 多轮修复后引入 linearized transaction 原语（私有 mkdtemp 目录、rename claim、hard-link 发布、committed boundary 分层），闭环所有数据丢失和假成功风险。后续 `79cd2b8..61a9f33` 修复了 video-channel 标签删除判据过宽导致合法正文被误删的问题，改为严格 token 序列匹配。最终 83 项测试全部通过，事务安全和内容解析均无回归，评估 Ready: Yes。

原始对话：dialogues/2026-0823.md

## 1712 规格核查多轮迭代直至通过

决策：無涘 ｜ 记录：codex（自动）｜ session 01a0295f-23c8-7ab1-b05f-94092d3c8ee1

多轮只读核查与修复循环，验证 clippings-migration.mjs 对规格的实现合规性。早期发现五类问题：findMigratedTarget() 旧 note/task 不一致时误返回 migration_note_missing；choosePortableNotePath() 未注入 fsOps；writeFile 抛错后 temp 未清理；并发 EEXIST 导致 owned temp 残留；YAML 空值被当作有效 source。修复后继续发现 H1 替换正则误匹配 fenced code block、CLI --apply 缺少测试、task 文件缺失未归类、old 删除 race、quarantine claim 后 snapshot 缺失导致 TypeError 及 ownership failure 未报告。后续通过多轮重放与修复，逐步覆盖 linearization/recovery 语义、commit-boundary cleanup、mkdtemp 失败路径、hashtag-line 规范化、legacy tag 行匹配、duplicate type 分类等边界场景，专项测试从 19/19 递增至 83/83，两轮 `node --check` 与 `git diff --check` 均通过，最终确认规格完全合规，仅改动三个指定文件。

原始对话：dialogues/2026-0823.md「1712 clippings-migration-spec」
