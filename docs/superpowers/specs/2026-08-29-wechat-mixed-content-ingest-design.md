# WeChat 文件传输助手混合内容采集修复设计

更新于 2026-08-29 · 记录者 Codex

## 背景

2026-08-28 的真实扫描暴露出五类问题：部分卡片被错误去重、图文 viewer 未执行 Copy Link、视频号没有稳定交付分享链接、图片被当作弱 OCR/纯文本跳过，以及聊天中的裸链接没有进入索引。

同时存在两个指向同一 GitHub 远端的本地仓库：

- 唯一源码真源：`/Users/haodong/Documents/AI/Codex/Clippings`
- 历史运行目录：`/Users/haodong/Documents/GitHub/AI-Clippings`

两者从共同祖先后分别有 16 和 13 个提交，不能用覆盖或强推收束。

## 目标

1. 可靠采集文章卡片、图文卡片、视频号、图片和裸链接。
2. 每个观察到的对象都有可辨认的最终状态，不能静默消失。
3. 图片 OCR 作为正式内容进入索引，并以可追溯的 Markdown 写入 PKM。
4. 保留两条 Git 历史，最终让 GitHub `main` 与两个本地仓库指向同一提交。

## 非目标

- 不扩大到 Bilibili 等当前明确不支持的视频平台。
- 不为图片摘要新增付费模型或网络调用。
- 不重写已有 Obsidian Web Clipper。
- 不提交真实聊天截图、私人 OCR 原文或运行时媒体。

## 源码与 Git 收束

采用保留双方历史的非破坏性合并：

1. 从唯一真源的当前提交创建隔离 worktree 和功能分支。
2. 将 `origin/main` 合并进功能分支；冲突按行为逐项解析，不能整文件盲选一侧。
3. 保留当前分支较新的视频号 `/sph/` 提链与后台处理链路，同时吸收远端分支已有的 viewer/OCR 稳定性修补。
4. 完成测试后只执行可 fast-forward 的 `git push origin HEAD:main`，禁止 force push。
5. 推送后让两个本地仓库 fast-forward 到同一远端提交；无关未提交与未跟踪文件不得被覆盖或带入提交。

## 类型化采集架构

页面观察、类型判断、内容提取、持久化和 PKM 发布分层处理：

```text
页面截图与 OCR
  -> typed blocks
  -> type-specific extractor
  -> durable index record
  -> PKM router
```

页面对象分为：

- `direct_url`：聊天正文中的单行或跨行 URL。
- `article_card`：公众号文章与可复制链接的图文卡片。
- `video_channel`：微信视频号卡片。
- `image_candidate`：未被前三类消费、点击后可由图片 viewer 确认的内容块。
- `unhandled_text`：普通文本或尚不能可靠识别的内容。

类型判断不能复用最终去重结果作为分类依据；每种类型使用独立提取器。

## 五类行为修复

### 1. 卡片漏采与错误去重

点击前的卡片身份不得由短标题前缀、公共来源 footer 或任意滑动子串决定。

- 同一可视页面内，以完整规范化文本和卡片几何区域识别同一对象。
- 跨相邻页面，只在完整规范化标题/正文一致且几何重叠证据成立时判为同一卡片。
- 公共来源行不能单独建立别名。
- 标题只在末尾一字或“上/下”等局部不同的卡片必须保持独立。
- 成功提链后，以规范化 URL 作为强身份。

### 2. 图文卡片 Copy Link

viewer 就绪条件从“标题匹配且文章壳正文达到阈值”改为：viewer 已打开、界面不再处于 Loading、窗口状态稳定。

- 标题匹配、正文行数和 metadata 仍写入诊断产物，但不再阻止打开菜单。
- 对文章和图文 viewer 都尝试查找 Copy Link。
- Copy Link 不存在、剪贴板未得到 URL、viewer 未关闭分别使用不同错误码。

### 3. 视频号链接与后台处理

- `video_channel` 是可执行类型，不得作为普通 skipped card 消费。
- 打开视频号 viewer 后使用其分享菜单复制 `https://weixin.qq.com/sph/...`。
- 成功 URL 写入索引并进入现有后台解析、转写、摘要和 Obsidian 发布链路。
- 失败时保留卡片身份、失败阶段、错误码与尝试次数；不能用空 pending 数量表示“没有视频”。

### 4. 图片 OCR 与 PKM

未被 URL、文章卡片或视频号消费的右侧 OCR 内容块可以成为图片候选，但只有点击后确实打开图片 viewer 才确认其类型。

确认后：

1. 对 viewer 中的图片区域重新执行 Vision OCR。
2. 生成同一索引中的内容记录：

```json
{
  "record_type": "content",
  "content_type": "image_ocr",
  "content_text": "...",
  "ocr_confidence": 0.0,
  "message_time": "...",
  "content_hash": "...",
  "pkm_status": "pending|written|needs_review|failed"
}
```

3. `query` 在 `image_contents` 中单独返回图片内容，不混入 URL 数组。
4. 使用现有已验证的 Obsidian Clippings 目录生成 Markdown。标题取首个有效 OCR 行；正文保留 OCR 原文及采集时间、来源、置信度和复核标记。
5. 不调用额外外部模型。低置信度内容仍写入索引并明确标为 `needs_review`，不能静默跳过。
6. 图片裁剪是临时恢复产物。索引和笔记回读验证成功后删除；失败时保留在本地 gitignored 运行目录并在 manifest 中记录路径。

### 5. 裸链接

- 从明确的 `http://` 或 `https://` 锚点开始识别，不要求 OCR cluster 至少两行。
- 允许把垂直相邻、符合 URL 连续字符规则的 OCR 行拼接为跨行 URL。
- URL 识别不依赖固定的右侧横坐标；聊天内容区边界只用于排除导航栏和侧栏噪音。
- 只有能通过 URL 解析与现有跳过规则的地址进入已确认链接；有歧义的进入 `uncertain_link`，不能直接丢弃。

## 状态与失败语义

每个观察到的对象必须进入以下互斥状态之一：

- `resolved`
- `duplicate`
- `unresolved`
- `skipped_by_policy`
- `failed`

`unresolved` 与 `failed` 至少保存：

- 稳定对象 ID 或内容指纹
- `failure_stage`
- `error_code`
- `attempt_count`
- 页面序号与可用的几何信息

viewer 若未恢复到文件传输助手，扫描必须显式中止，避免后续点击错位后仍报告完成。

manifest 分别记录文章、裸链接、视频和图片的 seen/resolved/duplicate/unresolved/failed 计数，并验证每类对象计数守恒。空数组必须能区分“确实没有”与“采集通道失败”。

## PKM 路由

- `records[].url`：继续交给现有 Obsidian Web Clipper。
- `video_channels[].url`：交给现有视频号后台状态机。
- `image_contents[]`：由本项目的图片内容发布器写入 Obsidian，不伪装成网页链接。
- `uncertain_links`、`unresolved_items`、`skipped_cards`：只作为审计与重试输入，不进入文章剪藏数组。

图片和视频笔记只有在写入后重新读取并验证关键正文非空时，才可标为 `written`。

## 测试设计

先添加失败测试，再实施最小修复。覆盖：

1. 标题公共前缀、公共 footer、上/下篇不会互相误判重复；相邻页面同一卡片仍会去重。
2. partial-title/图文 viewer 会继续尝试 Copy Link。
3. 视频号卡片复制 `/sph/` 并进入视频队列；复制失败留下明确状态。
4. 图片候选只有 viewer 确认后生成 OCR 内容；普通文本不误建图片笔记；空 OCR 与低置信度结果可辨认。
5. 单行与跨行裸链接都能恢复，导航栏噪音不会进入结果。
6. 扫描、查询、图片 PKM 发布和 manifest 计数的集成测试。

验证层级：

- 目标单元测试。
- `wechat-filehelper-macos-ingest` 完整 `npm test`。
- `git diff --check`。
- 使用 2026-08-28 本地真实运行产物离线回放，但不提交私人产物。
- 条件允许时执行小范围真实微信扫描；未完成现场验证的行为必须明确标注。

## 完成标准

- 五类用户报告的问题都有对应回归测试和实现。
- 离线真实产物中已知的单行及跨行裸链接被识别。
- 已知的错误重复样例保持为独立候选。
- 图片内容出现在索引、查询输出和经回读验证的 Obsidian 笔记中。
- 视频号不再进入普通 skip 路径。
- manifest 能对所有观察对象完成状态对账。
- GitHub `main` 与两个本地仓库的 `HEAD` 哈希一致；推送过程无 force。
