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
