# 竹居 · dsh-tjing-reading

一个开在 DSH 侧边栏里的 EPUB / PDF 阅读器：仿微信读书的排版与交互，支持目录、书签、划线与阅读进度记忆，并带一个只依据当前书本检索段落作答的 AI 问书助手。

[English](README.md) · **简体中文**

> 已在 DSH 0.2.1 – 0.2.2 上验证（桌面版与 `web` profile）· 纯 JavaScript，无构建步骤 · MIT

---

## 功能

- **导入**：通过文件选择器导入 EPUB / PDF，或直接把文件拖进书架。
- **阅读界面**：仿微信读书的排版，可调字号、行距、页边距，内置多套主题（默认、护眼绿、羊皮纸、暗黑）。
- **导航**：目录跳章、书签、划线。
- **进度记忆**：下次打开同一本书，回到上次的位置。
- **PDF**：22 档缩放、连续滚动、首页封面缩略图。
- **AI 问书**：只基于当前书本检索出的段落作答，流式输出并附上依据段落。
- **中英双语界面**。

## 安装

桌面版的 `desktop` profile 由应用自己管理，插件要在界面里装，不能用 CLI。

**桌面版** —— 设置 → 插件 → 添加插件，填入：

```
github:hijoywell/dsh-tjing-reading
```

**其他 profile**（web、tui 或自建）：

```bash
dsh plugin --profile web add github:hijoywell/dsh-tjing-reading
```

**从源码安装**（开发时）：

```bash
git clone https://github.com/hijoywell/dsh-tjing-reading
dsh plugin --profile web add "link:$PWD/dsh-tjing-reading"
```

装完重启 DSH，左侧边栏出现「竹居」图标。

> 尚未发布到 npm，`dsh plugin add dsh-tjing-reading` 会失败，请用上面的 Git 地址。

## 使用

1. 点侧边栏「竹居」→ 导入一本 EPUB 或 PDF。
2. 点书进入阅读；顶栏切换主题、字号、行距，目录面板负责跳章和加书签。
3. 选中文字可划线。右下角「问书」会把你的问题和当前书本的相关段落一起发给模型。

## 数据与隐私

书籍文件、书签、划线、阅读进度都保存在浏览器的 IndexedDB 里，不上传任何服务器。

IndexedDB 按站点（origin）隔离，所以换浏览器、换端口（另一个 profile、另一个 `dsh web` 端口）会看到空书架——这是浏览器的安全模型，不是数据丢失。

问书时，只有为这次提问检索出的少数段落（不是整本书）会随问题发给宿主里配置的模型，宿主不保存书本内容。没有配置模型时，问书入口会提示你去配置，而不是静默失败。

## 兼容性

- 已在 DSH `0.2.1-rc.5` 与 `0.2.2-rc.1` 上验证，覆盖桌面版与 `web` profile。
- 故意不声明 `engines.dsh`：写窄了会导致 DSH 升级后宿主拒绝加载插件。若宿主低于 0.2.1，侧边栏不会出现入口，请先升级 DSH。
- 只用标准 Web API：EPUB 用 `DecompressionStream` 解压，PDF 用 Canvas 渲染，存储用 IndexedDB。pdf.js（Apache-2.0）已内联进 `client.js`，运行时无外部依赖。

## 开发

```
index.js            宿主端 —— /api/bookshelf/ai/chat、/api/bookshelf/ai/models
client.js           浏览器端 —— 侧边栏入口、书架、阅读器、EPUB/PDF 解析
cordis.patch.yml    把插件挂进 loader 的 Cordis 补丁
locale/             zh.json / en.json
icon.svg            侧边栏图标
```

- 没有打包器、没有测试脚本、没有 npm 依赖：改完文件就是成品。
- 开发时用 `link:` 装进某个 profile，改完重启 DSH 生效（宿主端代码在进程内加载；只改 `client.js` 时先试试刷新页面）。
- `client.js` 里 `window.__ModuleLoader__.load({ id: 'dsh-tjing-reading', … })` 的 `id` 必须与包名一致，否则宿主解析不到客户端模块。

## 许可证

MIT
