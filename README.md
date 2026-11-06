# 竹居 (Zhu Ju) — `dsh-tjing-reading`

竹居（Zhu Ju）是专为 DSH 侧边栏及主面板设计的 **EPUB / PDF 阅读器插件**。它采用仿微信读书的清爽阅读界面，并内置了基于图书上下文的 AI 问书助手。

## 🌟 主要功能

- 📚 **图书管理与导入**：
  - 支持通过浏览器文件选择器或拖拽导入 **EPUB** 与 **PDF** 文件。
  - 图书数据和阅读进度在浏览器本地通过 `IndexedDB` 安全持久化存储。
- 📖 **微信读书风格阅读界面**：
  - 极致优雅的沉浸式阅读体验。
  - 支持多主题切换（默认、护眼绿、羊皮纸、暗黑模式等）。
  - 支持字号调节、行距调节、目录导航（TOC）以及章节跳转。
  - 内置 EPUB 解压（基于平台 `DecompressionStream`）与原生 PDF 渲染。
- 🤖 **AI 问书助手**：
  - 宿主端（Host）提供专有的 `/api/bookshelf/ai/chat` 接口。
  - 浏览器检索当前开放图书的相关段落切片（Passages），AI 结合书本上下文提供精确、带有依据的流式问答服务。
- 🧩 **DSH 模块化集成**：
  - 作为 DSH 插件无缝注册到左侧边栏 (`sidebar.panellist` -> `reader`) 及主面板。

---

## 📁 目录结构

- `index.js` - 宿主端（Host）后端逻辑，负责处理 AI 问书请求及上下文组装。
- `client.js` - 客户端（Client）前端逻辑，实现阅读器 UI、排版、EPUB/PDF 解析与图书管理。
- `cordis.patch.yml` - Cordis 补丁配置文件。
- `icon.svg` / `icon-glyph.png` - 插件图标。
- `locale/` - 多语言国际化支持（中文 `zh.json`、英文 `en.json`）。
- `vendor/` - PDF 渲染引擎等第三方依赖（PDF.js）。
- `package.json` - 插件元数据与 DSH 插件声明配置。

---

## 许可证

MIT License
