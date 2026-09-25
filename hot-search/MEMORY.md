# MEMORY

## 项目说明

`hot-search` 是「网络热梗追踪」SKILL 提示词项目，产出一份可直接复用的提示词（`SKILL.md`），
用于让 AI 检索近 14 天抖音 / B站为核心的全网热梗，并整理成 Excel 追踪表。

## 目录结构

- `SKILL.md`：核心提示词（Role / Profile / Core Rules / 分类体系 / 信源 / Excel 字段 / Workflow / 输出规范 / 自检清单）。
- `.codegraph/`：代码索引工具产物（非本项目业务内容）。

## 关键约定

- 时间窗口：当前日期往前 14 天。
- 一级信源：抖音、B站；二级：微博/小红书/快手/知乎/贴吧/豆瓣/公众号；三级：百度指数/巨量算数/新榜/飞瓜/YouTube/X。
- 热梗形式分类编码：A 视频、B 音乐/BGM、C 图片/表情包、D MMD/3D、E 鬼畜/二创、F 语言句式、G 舞蹈挑战、H 游戏、I AI 生成、Z 其他。
- Excel 文件名：`网络热梗追踪_<YYYYMMDD>.xlsx`；分表：总榜 / 分平台 / 潜力榜 / 字段说明与信源。
- 合规底线：过滤违规内容，争议梗标注风险提示。

## 操作记录

- 2026-09-25：依据 `internet-weekly-report/SKILL.md` 的范式，创建 `hot-search/SKILL.md`（网络热梗追踪提示词），并初始化本记忆文件。
