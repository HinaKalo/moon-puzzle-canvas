# Moon 剧情画板

Moon 自托管的 Excalidraw 画布，内置谜题依赖和分支剧情模板。画板保存在服务端，浏览器可以手工编辑，Codex 可以通过 MCP 读取和追加节点。

## 打开画板

公网入口是 [canvas.moonl.cloud](https://canvas.moonl.cloud/)。点击「使用 Moon SSO 登录」，所有启用的 Moon SSO 账号共享同一套画板。

Windows 在项目目录运行 `pwsh -File ./Open-MoonCanvas.ps1`。脚本沿已配置的 `moon` SSH 别名建立本机转发并打开画布。在其他已获 Moon SSH 访问权限的电脑，也可以运行：

```sh
ssh -NT -o ExitOnForwardFailure=yes -L 127.0.0.1:18847:127.0.0.1:18847 moon
```

此后打开 [本机画板](http://127.0.0.1:18847/)。SSH 转发关闭后可重新运行脚本。

- 新建时选择空白、谜题依赖图或分支剧情图。左侧可放入起点、场景、线索、道具、机关、选择、结局。
- 双击节点编辑文字。用 Excalidraw 的箭头工具吸附两个节点，或选中节点后在左侧选择下游。箭头 A → B 表示 A 是 B 的前置。节点可设置全部或任一前置条件。图片、说明文字和其他普通图形可直接放在画布。
- 打开依赖检查可定位不可达节点、没有通向结局的静态路径和循环候选。静态依赖闭包把可达节点视为可以共同到达，游戏中的互斥选择、条件变量、道具消耗和时序需另行验证。
- 点「保存」才将修改写入 Moon。其他客户端写入后点「重新加载」可取得最新版本。版本冲突时可先导出当前画布，再加载最新画板。原生 .excalidraw 导出文件可加入 Git。

## MCP

本机 Codex 使用 SSH stdio。该连接独立于浏览器转发，复用 Moon 上同一服务进程和存储。

```powershell
codex mcp add moon-puzzle-canvas --env "PROGRAMDATA=$env:ProgramData" -- ssh.exe -T -o BatchMode=yes -o ConnectTimeout=8 moon podman exec -i moon-puzzle-canvas node /app/stdio.mjs
```

已开启浏览器转发时，支持 Streamable HTTP 的客户端也可用 `http://127.0.0.1:18847/mcp`。

公网 Streamable HTTP 端点 `https://canvas.moonl.cloud/mcp` 需要画板的登录会话。Codex 的 SSH stdio 和本机转发方式适合无需浏览器登录的客户端。

| 工具 | 操作 |
| --- | --- |
| `list_boards` | 列出画板及版本 |
| `create_board` | 新建，模板取值 `blank`、`puzzle`、`story` |
| `get_board` | 查看图结构，可设置 `includeScene` 读取原生场景 |
| `append_graph` | 用当前 `revision` 追加节点和依赖 |
| `inspect_dependencies` | 验证静态依赖并返回涉及的节点 ID |

可试着向 Codex 说「用 Moon 剧情画板新建一张密室解谜图。两个线索同时解锁机关，机关通向结局。生成后检查依赖并给我画板链接。」

## 部署

Moon 使用独立的 Podman 容器，由 `moon-puzzle-canvas.service` 启动。应用 HTTP 仅监听 Moon 的 127.0.0.1:18847。Caddy 加载 `canvas.moonl.cloud.caddy`。SSO 客户端凭据保存在 Moon 上仅 root 可读的 `/etc/moon-puzzle-canvas/sso-client.env`。回调地址为 `https://canvas.moonl.cloud/auth/callback`。数据目录是 `/var/lib/moon-puzzle-canvas`，需由容器 UID 1000 写入。生产备份保留该数据目录。

在已上传源码的 Moon 部署目录构建 `podman build -t localhost/moon-puzzle-canvas:1.1.0 -f Containerfile .`。安装并启用仓库中的 systemd unit。升级时使用新镜像标签，验证独立端口后更新 unit 并重启。回滚时恢复上一版 unit 和对应的 Caddy 配置。

本地验证运行 `npm ci`、`npm run check` 和 `npm run build`。运行 `npm start` 可打开本地独立实例，数据默认写入项目的 `boards` 目录。

## 开发与 CI

依赖由 pnpm 管理（`packageManager` 字段，`corepack enable` 即可）；`package-lock.json` 保留给 `Containerfile` 里的 `npm ci`。两份锁文件需同步更新。

```sh
corepack enable
pnpm install
pnpm test        # node:test 单元测试（graph.mjs）
pnpm run build   # 复制 Excalidraw 字体到 public/fonts 并用 Vite 构建 dist/
```

GitHub Actions 在每次推送和 PR 时运行同样的测试与构建，并做密钥与依赖漏洞扫描。

## 许可证

本仓库代码以 [MIT](LICENSE) 发布。前端基于 [Excalidraw](https://github.com/excalidraw/excalidraw)（MIT）；
`public/fonts/` 中的字体在构建时从 `@excalidraw/excalidraw` 包复制，不随仓库分发，许可证见该包。
