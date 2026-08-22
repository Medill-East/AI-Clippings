# Clippings 可移植文件名设计

> 更新于 2026-08-22 · 记录者 Codex
>
> 状态：设计已获無涘确认，待实施计划与实现验收。

## 目标

文章 Web Clipper 与视频号后台写回必须生成同一种可预期、跨平台、适合 OneDrive 同步的文件名。文件名要保留主要语义，但不能直接照搬网页或视频标题中的站点名、尾部话题标签、Emoji 和任意标点。

统一格式：

```text
YYYY-MMDD-清洗后的主要标题.md
```

本设计只收束文件名与内容标题，不改变 Auto Note Mover、目标文件夹或内容抓取方式。

## 命名契约

### 日期

1. 优先使用内容自身的发布日期，按 `Asia/Shanghai` 转成 `YYYY-MMDD`。
2. 文章依次读取可信的页面发布时间、当前 Web Clipper 已生成的合法日期前缀；视频号使用官方 feed 的 `create_time`。
3. 内容发布日期确实不可取得时，使用本次采集日期，并在 manifest 或 task 中记录 `date_source=collected`；不能返回空日期或生成前导 `-`。
4. 相对日期（如小黑盒的“昨天 08:35”）以采集时刻和 `Asia/Shanghai` 为基准解析。

### 语义标题

语义标题用于 YAML `title` 和正文一级标题，允许保留正常中文标点；文件名再由语义标题生成可移植版本。

- 文章优先采用真正的内容标题。若 Web Clipper 字段是站点占位标题，而浏览器页面标题是具体文章标题，则采用页面标题。
- `Untitled`、`404`、`Weixin Official Accounts Platform`、`小黑盒 - 玩家高能聚集地` 等占位标题不得作为最终内容标题。若没有第二个可信标题，任务以 `title_unusable` 明确失败，不写合法但错误的占位笔记。
- 视频号从官方标题中删除第一个尾部话题标签及其后的全部 `#tag`；标签前的主要内容作为语义标题。原始完整标题仍保留在 task 的 `metadata.title` 中，不丢失来源证据。

### 可移植文件名标题

对语义标题执行以下确定性转换：

1. Unicode `NFKC` 归一化。
2. 只保留 Unicode 字母、Unicode 数字、单个 ASCII 空格与半角横杠 `-`。
3. 逗号、句号、冒号、问号、感叹号、括号、书名号、引号、斜杠、竖线、井号、百分号、波浪号、Emoji 及其他符号统一替换为单个空格。
4. 连续空白与连续横杠各自压缩；去掉首尾空格、横杠与句点。
5. 文件名 stem（含日期前缀、不含 `.md`）最多 100 个 Unicode code point；超长标题在尾部截断后再次清理。
6. 清洗后为空时以 `title_unusable` 失败，不能回退为 `Untitled`。

这一白名单比单纯删除 Windows 禁用字符更保守，目的是避开 OneDrive/Office 对逗号、`#`、`&`、`~` 的自动改名以及特殊字符 URL 编码带来的路径膨胀。

### 重名与幂等

- 首选路径为 `YYYY-MMDD-标题.md`。
- 若该路径已存在且 `source` 相同，视为同一条目并复用，不重复创建。
- 若路径已存在但 `source` 不同，在不突破 100 字符上限的前提下追加稳定的 8 位 source hash：`YYYY-MMDD-标题-1a2b3c4d.md`。
- 视频任务改名后必须同步更新 `task.note_path` 并记录迁移时间，否则幂等复跑会误判原笔记消失。
- 历史 run manifest 保持不可变；新运行在结果中记录实际写入路径和命名来源。

## 组件与数据流

### 共享命名模块

仓库增加一个无外部依赖的共享命名模块，至少提供：

- `stripTrailingHashtags(title)`：只处理视频号尾部话题标签。
- `selectCanonicalTitle({ pageTitle, clipTitle, sourceUrl })`：拒绝占位标题并选择可信文章标题。
- `buildPortableClippingStem({ title, publishedAt, collectedAt, sourceUrl })`：生成日期前缀、清洗标题并处理长度。
- `choosePortableNotePath(...)`：按 source 处理复用与冲突后缀。

文章与视频号只负责提供各自的标题、发布时间和 source，不各自复制一套清洗规则。

### 文章 Web Clipper

1. 页面加载后记录浏览器 `pageTitle` 与可取得的发布时间。
2. Web Clipper 完成摘要后读取 `clipTarget`。
3. 在点击 `Add to Obsidian` 前选择语义标题并生成统一文件名，回填 iframe 的标题与 note-name 字段。
4. 写入后同时以 source URL 和期望文件名回读验证；页面标题正确但扩展标题退化时不能再报告假成功。

### 视频号

1. 官方 feed 返回完整标题与 `create_time`。
2. 删除尾部 `#tag` 得到语义标题；task 继续保存完整原始标题。
3. 使用共享模块生成 `YYYY-MMDD-主要内容.md`，再写入笔记。
4. YAML `title` 和正文一级标题使用去标签后的语义标题；文件名使用保守白名单版本。

## 现有三篇迁移

迁移只修改路径和必要的标题字段，不重新抓取、转写或总结：

```text
2026-0821-采访 宫崎英高 开发一些多人游戏后 让你想再次开发单人游戏.md
2026-0815-项目发展规划到底要呈现什么内容.md
2026-0726-第58期 发现一个真正每天都能用上的效率神器 一个顶三.md
```

- 小黑盒笔记的语义标题改为 `［采访］宫崎英高：开发一些多人游戏后，让你想再次开发单人游戏`，不再保留站点占位标题。
- 两篇视频笔记的语义标题删除尾部话题标签；摘要、要点和 source 保持原样。
- 两个视频 task 的 `note_path` 指向新路径；历史媒体与逐字稿不恢复。
- 不处理用户已经删除的 `404`、`Untitled` 或微信验证页笔记，也不恢复它们。

## 失败与可观察性

- `title_unusable`：没有可信语义标题或清洗后为空。
- `published_missing` 不单独阻塞；明确降级到采集日期并记录 `date_source=collected`。
- `note_name_conflict`：基础名和 hash 后缀仍无法安全写入。
- 写入或迁移完成必须回读 source、实际文件名、YAML title 和正文标题；只看到 exit 0 不能算成功。

## 测试与验收

1. 共享模块单元测试覆盖中英文、全角标点、Emoji、OneDrive/Windows 禁用字符、尾部 `#tag`、空标题、100 字符上限和稳定冲突后缀。
2. 小黑盒回归夹具必须复现 `pageTitle` 正确、`clipTarget.title` 为站点名的实际差异，并得到具体文章标题。
3. 两条真实视频标题夹具必须分别得到 `2026-0815-项目发展规划到底要呈现什么内容` 与 `2026-0726-第58期 发现一个真正每天都能用上的效率神器 一个顶三`。
4. 迁移测试在临时目录验证文件改名、source 不变、视频 task 路径同步和重复运行幂等。
5. 运行两个模块的全套测试、两个 Skill 官方校验器，并对三篇真实笔记做独立回读；任何一步问不到结果都不能写成通过。

## 官方依据

- Microsoft Support：OneDrive/SharePoint 禁止字符、保留名称及首尾空格限制：<https://support.microsoft.com/en-us/office/restrictions-and-limitations-in-onedrive-and-sharepoint-64883a5d-228e-48f5-b3d2-eb39e07630fa>
- Microsoft Support：逗号、`#`、`&`、`~` 等在部分同步路径中可能被自动改名：<https://support.microsoft.com/en-us/office/why-has-my-filename-changed-f14307b4-e9ff-4cd9-be79-9524bb323744>
- Microsoft Support：OneDrive/SharePoint 完整路径限制与特殊字符 URL 编码影响：<https://support.microsoft.com/en-us/onedrive/what-are-file-path-length-limits>
- Microsoft Learn：Windows 文件名禁用字符、设备保留名与尾部句点/空格规则：<https://learn.microsoft.com/en-us/windows/win32/fileio/naming-a-file>
