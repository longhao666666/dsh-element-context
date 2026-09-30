<div align="center">

# dsh-element-context

**Pick UI elements straight into the conversation — selectors, source locations, box model and computed styles injected as context**

[![version](https://img.shields.io/badge/version-0.1.0-181717)](./package.json)
[![license](https://img.shields.io/badge/license-MIT-38a834)](./LICENSE)
[![platform](https://img.shields.io/badge/platform-Windows-0078D6)](https://github.com/longhao666666/dsh-element-context)
[![dsh](https://img.shields.io/badge/DeepSeek_Harness-%3E%3D_0.2.0--rc.2-5D45B0)](https://github.com/longhao666666/dsh-element-context)
[![stars](https://img.shields.io/github/stars/longhao666666/dsh-element-context?color=F9C513)](https://github.com/longhao666666/dsh-element-context/stargazers)

[简体中文](./README.md) | English

</div>

---

> **Zero dependencies**: a regular Cordis plugin loaded from plain JS source — no build step, no Token / API key, no extra services.

No more screenshots or "the button in the top-right corner" descriptions: click an element on the page and the model sees its full structured profile.

## Features

| Capability | Details |
| --- | --- |
| Mouse picking | Click 「点选元素」 above the composer to arm pick mode, then click any control in the sidebar browser page; pick multiple in a row, `Esc` to finish |
| Manual association | Type a CSS selector (e.g. `#submit-btn`) or a `file:line` source location — for hover-only elements or known source positions |
| Structured injection | Associated elements enter the system prompt as `<target_ui_element>` (single) / `<target_ui_elements count=N>` (multiple) |
| Element profile | Source location (`data-loc` plus nearest annotated ancestor), selector, tag / id / class / role, text content, page URL & title, viewport rect, box model, key computed styles |
| Chip management | Associated elements show as 「UI 上下文」 chips — remove individually or clear all; capped at 32 (~400 tokens per element per turn) |
| Sandbox-friendly | The probe is injected via `executeJavaScript`; the page's own sandbox is untouched |

## Requirements

- Windows
- DeepSeek Harness desktop installed and launched at least once (developed against 0.2.0-rc.2)

## Installation

One-click script (detects DSH, creates the `node_modules/@local` link, updates the profile config):

```powershell
git clone https://github.com/longhao666666/dsh-element-context.git
cd dsh-element-context
powershell -ExecutionPolicy Bypass -File .\install.ps1
```

<details>
<summary>Manual mount (click to expand)</summary>

```powershell
$profile = "$env:USERPROFILE\.dsh\profiles\desktop"
$repo    = "<path-to-clone>"    # e.g. "$HOME\code\dsh-element-context"

New-Item -ItemType Directory -Force "$profile\node_modules\@local" | Out-Null
New-Item -ItemType Junction -Path "$profile\node_modules\@local\dsh-element-context" -Target $repo
```

Then merge these fields into `$profile\package.json` (append inside existing fields):

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

</details>

Either way, **restart DeepSeek Harness** afterwards and confirm `@local/dsh-element-context` is enabled on the plugin management page.

## Usage

1. Open a session with a sidebar browser page (e.g. an "operation" preset).
2. Click 「点选元素」 — the status line reads 「在右侧浏览器页面里点击目标控件，可连续拾取多个；Esc 结束」.
3. Click the target control on the page; it appears in the 「UI 上下文」 chip list.
4. Send messages as usual — the model receives the full context of these elements on every turn.
5. Remove chips or clear the list when done to save tokens.

## Uninstall

```powershell
powershell -ExecutionPolicy Bypass -File .\install.ps1 -Uninstall
```

Takes effect after restarting DSH; the cloned repo files are left untouched.

<details>
<summary>How it works (click to expand)</summary>

- `host.js` (Node side): serves the `/element-context` route (guarded by the DSH connection-layer trust policy) and renders the element list from `~/.dsh/element-context.json` into the systemPrompt.
- `client.js` (browser side): the composer dock (manual input + chips) and the pick probe. The desktop browser is an Electron `<webview>`; the client acts as the embedder, injects the probe with `executeJavaScript`, and reads captures back by polling.

</details>

## Related plugins

- [dsh-ask-mode](https://github.com/longhao666666/dsh-ask-mode) — one-click consultation mode in the session
- [dsh-session-delete](https://github.com/longhao666666/dsh-session-delete) — one-click session deletion in the sidebar

## License

[MIT](./LICENSE)
