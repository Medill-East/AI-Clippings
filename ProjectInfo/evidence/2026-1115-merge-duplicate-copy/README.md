# 副本比对与合并证据

更新于 2026-11-15 01:43:25 +0800 · 记录者 Codex

## GitHub 规范目录

HEAD: `bb8b35de7cb33550c874bd02a894dd1c68f06abc`

```text
* main bb8b35d [origin/main: ahead 9] docs: record merged 20-link clipping delivery without rerunning collection

```

### 被忽略但有内容的数据

|目录|文件数|逻辑字节|判断|
|---|---:|---:|---|
|wechat-filehelper-macos-ingest/local/|13127|5199329816|有保留价值，逐文件比对保全|
|wechat-filehelper-macos-ingest/node_modules/|182|18674260|可重建依赖，不复制|
|wechat-filehelper-web-ingest/local/|206|10372618|有保留价值，逐文件比对保全|
|wechat-filehelper-web-ingest/node_modules/|554|13191150|可重建依赖，不复制|

## Codex 旧副本

HEAD: `dfea0949afc7c3a929b4e917b0f340e0239c2256`

```text
+ codex/clippings-portable-filenames 61a9f33 (/Users/haodong/Documents/AI/Codex/Clippings/.worktrees/clippings-portable-filenames) fix: require legacy title tags for cleanup
* main                               dfea094 [origin/main] Support a single Web Clipper pass without retries

9729d896dd38e48a7b8abf3b4cba1a46970df2c7 stash@{0} On main: codex-preserve-before-wechat-sync-20260829-1149
f93694ba27fbc2f242d87f25744b15351904457c stash@{1} On main: codex-preserve-before-wechat-sync-20260829-0342
```

### 被忽略但有内容的数据

|目录|文件数|逻辑字节|判断|
|---|---:|---:|---|
|obsidian-web-clipper-ingest/local/|713|161068529|有保留价值，逐文件比对保全|
|obsidian-web-clipper-ingest/node_modules/|554|13191149|可重建依赖，不复制|
|wechat-filehelper-macos-ingest/local/|2797|240602504|有保留价值，逐文件比对保全|
|wechat-filehelper-macos-ingest/node_modules/|182|18674260|可重建依赖，不复制|

旧副本另有 .worktrees/clippings-portable-filenames/（du 分配约 15 MiB）：独立 Git 工作树，HEAD 61a9f33，工作区干净；只有被忽略的 node_modules，无额外未提交或未跟踪资料。源码由本仓 backup/codex-20261115/codex/clippings-portable-filenames 完整保留。

## 文件级清单

- comparison.tsv：两边全部枚举文件的存在/内容差异、大小和价值判断，包括仅 GitHub 存在的文件。
- copy-actions.tsv：旧副本每一项的处理结果与差异副本路径。
- *-before.json：完整文件类别、字节数与 SHA256，以及 HEAD、分支、stash、状态、远端和工作树快照。
- github-head/：应用旧副本 21 项未提交更改前的规范目录版本；与主路径当前版本共同保留。
- codex-worktree/：未应用到主路径的同名差异副本。
- 仓库根目录 .duplicate-merge-20261115/codex/：570 项同路径不同内容中的运行数据副本（其余为旧 trace 索引），由 .git/info/exclude 排除。原 local/ 的 ignore 规则维持不变。
- verification.json：文件内容与源仓状态复核。
- preserved-refs.json：独有分支、stash 的本地恢复入口。
- old-path-references.md：旧路径完整引用清单及直接影响使用的引用。

## 分支与 stash 判断

主线：GitHub HEAD bb8b35d 是 Codex HEAD dfea094 的祖先；左右独有提交 0/24，已快进。原 origin/main 跟踪引用分别显示 GitHub ahead 9、Codex 0；这是本地缓存状态，未联网 fetch origin，未把它宣称为远端实时状态。

旧分支 codex/clippings-portable-filenames 相对 dfea094 左右独有 82/22；22 个提交涉及便携命名、幂等迁移、原子写入及竞态防护，有价值。整条分支已导入 backup/codex-20261115/codex/clippings-portable-filenames，未把这条历史功能路线强行并入 main；后续如要启用，需单独与当前主线整合和验收。源码与完整提交历史在本仓可恢复，不再只存在旧副本。

旧 stash 两项均含历史记录、Mac 默认配置、Obsidian 路径及 Interpreter 就绪判断的修改；工作区中已有其中多项，故不重复 apply。两条 stash 的提交及全部 parent（包括未跟踪快照若有）完整导入本仓 backup/codex-20261115/stash-0、stash-1。旧 stash 列表本身不动。

本仓原改动保存在 stash pre-duplicate-merge-20261115-github-worktree，并已 apply 恢复且保留 stash；原 HEAD 保存在 backup/pre-duplicate-merge-20261115。没有执行 stash pop/drop。
