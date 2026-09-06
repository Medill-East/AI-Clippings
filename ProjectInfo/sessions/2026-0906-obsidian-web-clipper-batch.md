# obsidian-web-clipper-batch

## 1540 2026-09-06 微信文章剪藏与并发错配修复

决策：無涘 ｜ 记录：Codex

- 读取附件 `/Users/haodong/.codex/attachments/86e69139-7548-491a-a6dc-012f3564433b/pasted-text.txt`，确认本轮扫描结果包含 22 条公众号 URL、3 条视频号 URL、2 条图片 OCR 内容和 4 条 unresolved 项。按分流契约，只把 22 条公众号 URL交给 Web Clipper；视频号不重复启动已有后台处理。
- 用户确认后执行 22 条文章批处理。首次启动暴露环境问题：Playwright 默认寻找已清理的 chromium-1208；回归测试先失败，再补传 `config.chromePath`。随后发现 Google Chrome 152 忽略 `--disable-extensions-except`，本机已有 Chrome for Testing 151 可用，切换本地生成配置后扩展 worker、`chrome.storage` 和 headed 启动均通过真实探针。
- 首轮并发 10 的 22 条运行表面为 22/22 success，但逐条检查 `clipTarget.sourceUrl` 发现 5 条把不同页面的 active tab 剪藏目标写到了当前 URL，属于假成功。加入 URL-to-tab 映射回归测试与实现：用 `chrome.tabs.query({})` 按页面当前 URL精确查找 tab ID；5 条受影响 URL 改为串行重跑。
- 串行修复运行完成 5/5，所有修复结果的 `clipTarget.sourceUrl` 与请求 URL一致。5 个首轮错配笔记已从 vault 移到 `obsidian-web-clipper-ingest/local/quarantine/false-success/2026-09-06-concurrent-tab-mismatch/`，不删除、可恢复。
- 最终合并验收：22 条 URL、22 个唯一笔记路径、文件均存在且非空、每个文件包含对应源 URL；最终文章状态 complete。TDD 全量测试 `npm test` 为 17 pass / 0 fail，`git diff --check` 通过。
- 视频后台 manifest 仍为 `running`，但对应进程已消失且无结果；不把视频标为完成。若继续，需要另行确认视频批处理预算，并在必要时处理元宝登录。

原始对话：`dialogues/2026-0906.md「1540 处理微信文件传输助手链接」`
