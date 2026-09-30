# dsh-element-context

DeepSeek Harness（DSH 桌面版）插件：在对话中直接「圈选」浏览器页面上的 UI 元素，把元素的结构化上下文（选择器、源码位置、盒模型、计算样式等）注入模型提示词——不用截图，也不用口头描述「就是右上角那个按钮」。

## 功能

- **鼠标点选**：点击输入框上方的「点选元素」按钮进入点选模式，直接点击右侧浏览器页面里的控件即可关联，可连续拾取多个，按 `Esc` 结束。
- **手动关联**：在输入框里填写 CSS 选择器（如 `#submit-btn`）或源码位置（`文件:行号`），适合 hover 才出现的元素、或已知源码位置的场景。
- **结构化注入**：关联的元素以 `<target_ui_element>`（单个）/ `<target_ui_elements count=N>`（多个）的形式进入系统提示词，内容包括：
  - 源码位置（`data-loc`，以及最近带位置标注的祖先节点）
  - CSS 选择器、标签 / id / class / role / name
  - 文本内容、所在页面 URL 与标题
  - 视口矩形、盒模型、关键计算样式
- **Chip 管理**：已关联的元素显示为输入框上方的「UI 上下文」chip 列表，可单个移除或一键清空；最多 32 个（每个元素每轮请求约占 400 token，建议用完就删）。

## 环境要求

- Windows
- DeepSeek Harness 桌面版已安装，并至少启动过一次（开发时基于 0.2.0-rc.2 验证）

## 安装

### 方式一：一键脚本

```powershell
git clone https://github.com/longhao666666/dsh-element-context.git
cd dsh-element-context
powershell -ExecutionPolicy Bypass -File .\install.ps1
```

脚本会自动检测 DSH、建立 `node_modules/@local` 链接、把插件写进 profile 配置。

### 方式二：手动挂载

```powershell
$profile = "$env:USERPROFILE\.dsh\profiles\desktop"
$repo    = "<你的克隆路径>"    # 例如 "$HOME\code\dsh-element-context"

New-Item -ItemType Directory -Force "$profile\node_modules\@local" | Out-Null
New-Item -ItemType Junction -Path "$profile\node_modules\@local\dsh-element-context" -Target $repo
```

然后编辑 `$profile\package.json`，合并以下字段（已存在的字段里追加即可）：

```json
{
  "dependencies": {
    "@local/dsh-element-context": "link:C:/Users/you/code/dsh-element-context"
  },
  "dsh": {
    "profile": {
      "bundles": ["@local/dsh-element-context"]
    }
  }
}
```

两种方式完成后都需**重启 DeepSeek Harness**，并在「插件管理」页确认 `@local/dsh-element-context` 已启用。

## 使用说明

1. 打开一个带侧栏浏览器页面的会话（如「操作」类预设）。
2. 点击输入框上方的「点选元素」，状态栏提示「在右侧浏览器页面里点击目标控件，可连续拾取多个；Esc 结束」。
3. 在右侧页面上点击目标控件，元素随即出现在「UI 上下文」chip 列表中。
4. 正常发送消息——模型每轮都会收到这些元素的完整上下文。
5. 不再需要时，点 chip 上的移除按钮或「清空」，节省 token。

## 卸载

```powershell
powershell -ExecutionPolicy Bypass -File .\install.ps1 -Uninstall
```

重启 DSH 后生效；克隆下来的仓库文件不会被删除。

## 工作原理

- `host.js`（Node 侧）：注册 `/element-context` 路由（受 DSH 连接层信任策略保护），并把 `~/.dsh/element-context.json` 中的元素列表渲染为 systemPrompt 上下文块。
- `client.js`（浏览器侧）：输入框 dock（手动输入 + chip 列表）与点选探针。桌面端浏览器是 Electron `<webview>`，client 作为宿主用 `executeJavaScript` 向页面注入探针并轮询读回采集结果，页面自身的沙箱不受影响。

## 相关插件

- [dsh-ask-mode](https://github.com/longhao666666/dsh-ask-mode) — 会话内一键切换「咨询模式」
- [dsh-session-delete](https://github.com/longhao666666/dsh-session-delete) — 侧栏一键删除会话

## 许可证

[MIT](./LICENSE)
