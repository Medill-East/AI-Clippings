# Obsidian Web Clipper 批处理

## 1315 2026-08-22 FileHelper 链接处理

决策：無涘 ｜ 记录：Codex

- 依据附件中的扫描报告，只纳入“已收集链接”区的 31 条 URL；待确认的截断前缀和 14 个跳过卡片不处理。
- 按 `obsidian-web-clipper-ingest/SKILL.md` 运行预检和批处理，使用并发 10。
- 首轮结果为 30 成功、1 失败；失败项是英伟达微信文章，skill 的并发 2 重试后成功。
- 最终 manifest 为 31 成功、0 失败、0 dry-run。
- vault 级验收发现 31 个新 Markdown。30 条 source 完全匹配；小黑盒输入链接被页面规范化为 `/app/bbs/link/9d5b7253e7c6`，通过 `link_id=9d5b7253e7c6`、标题和正文核验为同一条内容。
- Auto Mover 将文件最终放到 `Clippings` 根目录；没有改动 Auto Mover 规则。

产出：

- 输入：`obsidian-web-clipper-ingest/local/inputs/2026-08-22-filehelper-links.txt`
- Manifest：`obsidian-web-clipper-ingest/local/runs/2026-08-22T05-07-00-690Z/manifest.json`
- 最终目录：`/Users/haodong/Documents/GitHub/PKM/PlayWithExperiences/Clippings`

原始对话：`dialogues/2026-0822.md「1315 Obsidian Web Clipper 批处理」`

## 1405 代码审查修复保存验证与碰撞解析问题

决策：無涘 ｜ 记录：codex（自动）｜ session 01a02917-544f-7483-b3d6-b0b63f78b641

本次会话对obsidian-web-clipper-ingest的保存流程进行只读代码审查与多轮修复。首轮发现Critical问题：保存后验证仍为「任一条件命中即成功」，导致假阳性；Important问题包括readdir异常静默吞错、冲突解析仅检查首候选、source正则作用于整篇Markdown而非仅frontmatter、任意日期候选被宽松解析为发布日期。修复后通过严格post-save验证（同时要求exact stem、mtime、唯一YAML source和title）、聚合全量候选判断、移除通用time[datetime]改为格式白名单校验，并支持NFKC+case-folded stem比较、合法ISO变体及瞬时ENOENT重试。最终全量测试31/31通过，大小写冲突、六位小数秒、±HHMM偏移、移动竞态等边界均覆盖，无Critical/Important遗留问题，评估为可合并。

原始对话：dialogues/2026-0823.md

## 1406 Web Clipper 笔记名适配 TDD 迭代三阶段

决策：無涘 ｜ 记录：codex（自动）｜ session 01a02911-e601-76c3-a43d-836b37331949

在 obsidian-web-clipper-ingest 模块内，按 TDD 工作流分三次提交完成 clip-target-naming 适配：首次提交（eba8a1d）新增 adapter，实现标题解析、发布时间提取、同源冲突处理，并修补失败路径中 bodyText 持久化风险；追加提交（0e36e33）引入严格 waiter，改为精确 stem + 新鲜 mtime + 首段 frontmatter 唯一 source/title 四重判据，收紧日期校验拒绝宽松/非法值；最终提交（519590b）引入 NFKC+大小写折叠统一比较键，支持扩展日期格式与 YAML 单引号转义，仅 waiter 容忍候选 ENOENT 竞态。全量测试从 21/21 升至 31/31，staged diff 始终仅含指定文件。未做真实 Chrome/Obsidian dry-run。

原始对话：dialogues/2026-0823.md
