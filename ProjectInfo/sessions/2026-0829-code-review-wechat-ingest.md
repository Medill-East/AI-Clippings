# code-review-wechat-ingest

> 按主题一份，追加不覆盖；同一场会话的节就地更新。

## 0406 多轮只读审查：图片重路由、幂等修复与UI恢复失败

决策：無涘 ｜ 记录：codex（自动）｜ session 01a049ca-4030-75e0-bbbb-80faba453e51

对 wechat-filehelper-macos-ingest 项目提交 cb1f6ac 进行三轮只读代码审查。第一轮发现5个Important问题：文章viewer误判图片、旧图片笔记因新增frontmatter导致幂等冲突（已复现image_note_conflict）、旧记录时间来源显示问题、Playwright Node版本声明不一致、vault探测静默吞掉权限错误。修补后第二轮确认大部分问题已修复，但仍保留1个Important：文章探测返回非ok结果（viewer_not_closed/chat_not_recovered）时会回退为OCR图片发布，掩盖UI失控。第三轮补测恢复失败场景后，UI回归76/76通过，verdict由Not Ready转为Ready。核心产出：相对时间基准修正、图片→文章重路由链路、旧笔记按dedupe_key+OCR hash幂等、Node要求提升至>=20、vault错误不再静默折叠。

原始对话：dialogues/2026-0829.md「0406 code-review-wechat-ingest」
