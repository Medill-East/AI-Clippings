# ProjectProgress

更新于 2026-11-15 01:44:46 +0800 · 记录者 Codex

## 当前状态

- 规范目录为 `/Users/haodong/Documents/GitHub/AI-Clippings`。已从旧副本快进补入 24 个主线提交（bb8b35d → dfea094），导入其 21 项未提交改动及 19 个新增资料/测试文件。
- 已核验 3,686 项有价值的旧副本文件在本仓内容一致或有保留的差异版本。2,829 项新运行数据补入原 local/；569 项同名运行数据保留当前版本，旧版放根目录 `.duplicate-merge-20261115/codex/`（本机忽略，不提交）。另保留旧 trace-pending 索引副本。共复制/保全约 403 MB。
- 本仓原未提交内容已命名 stash 备份并恢复；原 HEAD 有 backup/pre-duplicate-merge-20261115。旧副本两项 stash、main 及独有命名迁移分支均已保存在本仓 backup/codex-20261115/*。独有分支的 22 个提交保持独立，不宣称已启用其中功能。
- 本仓原有 14,069 个忽略文件逐项核验未变；旧副本 4,426 个枚举文件及 HEAD/分支/stash/remote/status 均核验未变。旧工作树干净，依赖可重建。旧目录未删除、未移动；临时 remote 已移除，origin 未改，未 push。
- Web Clipper 21 项、微信采集 226 项测试通过；本次未运行在线剪藏或重新核验历史文章完成状态。

## 仍需处理

- 旧目录暂不宜归档/移位：已安装 Web Clipper 技能的符号链接仍指旧目录，Director/projects.json、board-state.json 等仍有引用。本次按要求只列清单，不改接线。
- 历史命名迁移分支如需启用，另行与现主线整合并验收；其完整历史已在本仓保存。
- 采集业务状态沿用合并前快照，未当作本轮重新验证：见 evidence/2026-1115-merge-duplicate-copy/merge-base-ProjectProgress.md。原记录指出 11/9 批次 40/42，2 篇微信验证待处理。

## 证据入口

- 本场摘要：sessions/2026-1115-merge-duplicate-copy.md
- 比对、逐项价值判断、恢复入口：evidence/2026-1115-merge-duplicate-copy/README.md
- 旧路径完整引用：evidence/2026-1115-merge-duplicate-copy/old-path-references.md
- 未提交的系统 .DS_Store 留在原地；本机运行数据与 stash/备份分支也不在本次 main 提交的数据范围内。
