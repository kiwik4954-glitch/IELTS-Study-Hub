# IELTS Study Hub — Phase 0 架构审计报告

> 审计对象：ISTS `aimerfeng/ists`、BandReady `Luxshan2000/ielts-prep`
> 审计方式：源码与文档逐项核对（不修改上游），本地副本 + 上游 tarball
> 审计日期：2026-11-17
> 结论级别：可用于 Phase 1 立项；带「待验证」的条目必须在 Phase 5 用真机确认

---

## 0. 结论摘要

1. **两个上游都可以在不修改源码的前提下被 Hub 启动**，前提是 Hub 用环境变量和命令行参数控制端口、数据目录、监听地址。
2. **ISTS 必须显式加 `-H 127.0.0.1`**：`next start` 默认监听 `0.0.0.0`，直接启动会把学习系统暴露到局域网，违反项目的隐私原则。
3. **BandReady 的官方浏览器版已经存在**（`bandready` 命令 / `launch.py`），它自带启动密钥和浏览器跳转，Hub 只需要启动它、读取它写下的端口状态，再打开对应 URL，不需要 iframe、不需要代理。
4. **两套技术栈的端口、包管理器、Python 版本都不相同**，Hub 不能强制统一：
   - ISTS：Next 16 + pnpm 10.30.3 + Node ≥20（无 engines 字段）+ 端口 3000
   - BandReady：Electron 33 + pnpm 9.12.0 + Node ≥20 + Python ≥3.11（uv 管理）+ 浏览器版端口 8765
5. **许可证均为 MIT**，源码分发安全；但 BandReady 的 `voice` 扩展依赖 `kokoro-onnx`（经 `phonemizer` / `espeakng-loader`）带 **GPL-3.0** 条款，**打包二进制分发前必须单独审查**。第一版只发源码，规避该风险。
6. **ISTS 没有 `/health` 接口**，就绪判定只能用 `GET /` 返回 200；BandReady 有未鉴权的 `GET /health`。
7. **ISTS 构建存在两个已知坑**（本机实测）：`next/font` 构建期要访问 Google Fonts；`better-sqlite3` 在无预编译包时需要本地 C++ 工具链。安装文档必须写明，setup 脚本要能检测并给出指引。

---

## 1. 上游版本与许可证

| 项 | ISTS | BandReady |
|---|---|---|
| 仓库 | `github.com/aimerfeng/ists` | `github.com/Luxshan2000/ielts-prep` |
| 审计提交 | `1088fe0f11391ec0106d5225c40ae310c57a37ba`（2026-07-18） | `b2d67d409e69be60962ca2d123733be0d572761e`（2026-11-08） |
| 最新发布 | 无 tag 发布，main 即源码 | `v0.1.0-rc6`（预发布，2026-11-08） |
| 许可证 | MIT（Copyright 2026 Aimer Feng） | MIT（Copyright 2026 Luxshan Thavarasa） |
| 内容许可 | 仓库示例为原创 | 内容 CC0-1.0；模型权重不随仓库分发 |

**建议**：Submodule 钉上述两个提交；`THIRD_PARTY_NOTICES.md` 记录仓库地址、提交号、许可证、以及“与 IELTS 官方无隶属关系”的声明。

---

## 2. 技术架构

### 2.1 ISTS

- Next.js App Router **16.2.10**，React **19.2.4**，TypeScript，Tailwind 4 + CSS Modules
- 数据：SQLite（`better-sqlite3`），Zod 校验
- 文件导入：`pdf-parse`（PDF）、`mammoth`（DOCX）、文本/图片/音频
- AI：OpenAI Responses / Chat Completions 兼容端点，支持多 provider 回退
- 单用户、本地优先，无账号系统
- 路由自动发现：`src/app/api/*`（coach / export / materials / mock-exam / notion / practice / review / tasks / uploads / vocabulary / writing）

### 2.2 BandReady

- Electron **33.2.0** 外壳 + React 渲染层（Vite）
- Python FastAPI sidecar（`sidecar/bandready`），uv 管理，Python **≥3.11**
- 三种运行形态：
  1. **桌面版**（Electron 启动，sidecar 由 Electron 拉起，端口随机）
  2. **浏览器版**（`bandready` CLI / `launch.py`：sidecar 同时托管页面，默认 8765，自动开浏览器）
  3. **源码 dev 模式**（`node scripts/dev.mjs [--browser]`：Vite 5273 + sidecar 8710）
- 数据：`%APPDATA%\BandReady`（数据库、模型、录音、密钥）
- 健康检查：`GET /health`（未鉴权，`server/routes/system.py`）
- 浏览器版安全模型：启动密钥写入 `web.json`（仅当前用户可读），通过 `/?launch=<secret>` 交给浏览器；`/launch-proof` 用于二次启动复用正在运行的服务

---

## 3. 启动方式与端口（实测/源码确认）

### 3.1 ISTS

```bash
pnpm install
pnpm build
pnpm start -- -H 127.0.0.1 -p 3000   # 关键：-H 必须显式指定
```

- 默认端口 **3000**（`PORT` 环境变量或 `-p` 可改）
- **默认监听 `0.0.0.0`**（`next start --help` 确认），Hub 必须加 `-H 127.0.0.1`
- 依赖安装：`packageManager: pnpm@10.30.3`（corepack 会按此版本执行）
- 无 `engines` 字段；Next 16 实际要求 Node ≥20.9，当前 Node 24 可用

### 3.2 BandReady（浏览器版，推荐接入形态）

```bash
uv tool install --python 3.11 "bandready-sidecar[voice] @ <wheel>"
bandready            # 启动并在浏览器打开；默认 8765，占用则顺延到空闲端口
```

- 端口：`8765` 优先；被占用时自动换端口，状态写入 `%APPDATA%\BandReady\web.json`
- 密钥：同一 `web.json` 中的 launch secret；URL 形如 `http://127.0.0.1:<port>/?launch=<secret>`
- 二次启动会复用已在运行的服务（`/launch-proof` 校验）
- 只有 `GET /health` 免鉴权，其余 API 需要 Bearer token / launch 会话
- 安装体积：带 `[voice]` 约 **800 MB**（install.ps1 明示）；不带 voice 可显著减小，但听力音频、口语考官、本地 Whisper 不可用
- 该形态不需要用户装 Node、Git 或 Python（uv 自带 Python）

### 3.3 BandReady（源码 dev 模式，备选）

```bash
pnpm install
cd sidecar && uv sync --extra dev --extra voice && cd ..
node scripts/dev.mjs --browser --no-mock --port 5273 --sidecar-port 8710
```

- Vite **5273**，sidecar **8710**，默认 token `dev-token`（可用 `BANDREADY_DEV_TOKEN` 覆盖）
- **默认开启 mock**（`BANDREADY_ENABLE_MOCK=1`），联调必须加 `--no-mock` 才是真实数据
- 数据目录默认 `<repo>/.dev-data`（`--data-dir` 可改）
- 适合开发/CI，不适合作为面向普通用户的启动路径

---

## 4. 健康检查与就绪判定

| 应用 | 探针 | 说明 |
|---|---|---|
| BandReady | `GET http://127.0.0.1:<port>/health` | 未鉴权；需同时确认该端口确实由 BandReady 提供（浏览器版用 `/launch-proof` 校验，Hub 可读取 `web.json` 的端口） |
| ISTS | `GET http://127.0.0.1:3000/` 返回 200 | 无专用 health 接口；不能仅凭端口开放判定就绪 |
| Portal | 自身由 Hub 进程提供 | `/api/state` 返回各模块状态 |

**状态机（Hub 内部）**：

```
not-installed → not-ready → starting → running → stopped / error
```

- `running` 必须同时满足：进程存活 + HTTP 探针通过
- 进程存活但探针失败 → `error`，并展示最后 N 行日志
- 启动超时（ISTS 60s，BandReady 180s，首次要跑迁移/播种）单独提示

---

## 5. 数据存储与隐私

| 数据 | 位置 | 是否可配置 | 风险 |
|---|---|---|---|
| ISTS 数据库 | `apps/ists/data/ists.db`（默认，相对 cwd） | `DATABASE_URL` | 在仓库目录内，误提交风险；需 gitignore |
| ISTS 上传 | `apps/ists/data/uploads/` | `UPLOAD_DIR` | 同上 |
| BandReady 数据 | `%APPDATA%\BandReady`（`default_data_dir()`） | `BANDREADY_DATA_DIR` | 在仓库外，天然安全 |
| BandReady 浏览器版状态 | `%APPDATA%\BandReady\web.json`（含 launch secret） | 随数据目录 | **禁止提交、禁止日志打印** |
| ISTS `.env.local` | 项目根 | — | 含 API Key，必须忽略 |

**建议**：
- Hub 默认把 ISTS 数据指向 `%APPDATA%\IELTS-Study-Hub\ists\`（`DATABASE_URL`、`UPLOAD_DIR` 绝对路径），避免数据落在 git 工作区；对已有用户提供迁移说明。
- Hub 自己的配置/日志放 `%APPDATA%\IELTS-Study-Hub\hub\`，不写仓库。
- 主仓库 `.gitignore` 必须覆盖：`.env*`（保留 `.env.example`）、`*.db*`、`data/`、`uploads/`、`models/`、录音、日志、`web.json`、构建产物。

**ISTS 的访问控制**：可选 `ISTS_BASIC_AUTH_USER/PASSWORD`；Hub 默认只绑回环，不启用也不暴露公网。

---

## 6. 环境兼容性

| 工具 | 当前机器 | ISTS 要求 | BandReady 要求 | 结论 |
|---|---|---|---|---|
| Node | 24.21.0 | Next 16 → ≥20.9（无 engines 声明） | `engines.node: >=20` | 兼容 |
| pnpm | 12.14.0 全局 | `packageManager: pnpm@10.30.3` | `packageManager: pnpm@9.12.0` | **不能共用一个版本**；用 corepack 按项目切换 |
| Python | 3.13.14 | 不需要 | ≥3.11（uv 会固定 3.11） | 兼容；不要改全局 Python |
| uv | 已安装（`~/.local/bin/uv.exe`） | — | 必需 | 兼容 |
| C++ 工具链 | VS 2026 + Windows SDK 已装 | `better-sqlite3` 可能需要源码编译 | 无 | 可用；文档写明 |

**已知构建坑（本机实测）**：
1. `next build` 会通过 `next/font` 拉 Google Fonts，网络受限时直接失败（`Failed to fetch Geist`）。缓解：构建时允许外网/代理，或在 Phase 2 评估离线字体方案（不改上游核心逻辑）。
2. `better-sqlite3` 预编译包下载失败时需要 `node-gyp` + VS C++ 工具链；setup 脚本应检测并提示，而不是静默失败。

---

## 7. Git Submodule 组织

```
IELTS-Study-Hub/
├── apps/
│   ├── ists/          submodule → aimerfeng/ists @ 1088fe0
│   └── bandready/     submodule → Luxshan2000/ielts-prep @ b2d67d4
├── portal/            React + TS + Vite
├── scripts/           Node 进程管理 + 环境检查
├── docs/
└── README.md / LICENSE / THIRD_PARTY_NOTICES.md / .gitmodules
```

- 克隆：`git clone --recurse-submodules <hub>`；已有克隆：`git submodule update --init --recursive`
- 升级上游：在 submodule 内 checkout 新提交 → 主仓库提交指针变更 → 跑验收测试
- **不要在 Hub 里复制上游源码**；不要 `git subtree` 混入历史

---

## 8. 推荐集成架构

```
┌──────────────────────────────────────────────┐
│ Hub 服务（Node，127.0.0.1:8780）              │
│  ├─ 静态托管 portal/dist                      │
│  ├─ /api/state  进程与探针状态                │
│  ├─ /api/start|stop  仅管理自己 spawn 的 PID  │
│  └─ 配置/日志：%APPDATA%\IELTS-Study-Hub\hub   │
└───────┬───────────────────────┬──────────────┘
        │ spawn                 │ spawn
        ▼                       ▼
┌────────────────┐      ┌────────────────────────┐
│ ISTS           │      │ BandReady 浏览器版      │
│ next start     │      │ bandready (launch.py)   │
│ 127.0.0.1:3000 │      │ 127.0.0.1:8765 (或顺延) │
│ / 探针         │      │ /health + web.json      │
└────────────────┘      └────────────────────────┘
```

- **不使用 iframe**：麦克风、WebRTC、音频、Cookie、跨源认证都会踩坑；统一入口用“打开新页面”实现。
- **不代理 AI 请求**：两个应用各自持有 provider 配置；Hub 不碰 API Key。
- **不合并数据库**：第一阶段只做状态与入口；P1 统计另立只读接口/导出方案。
- **Portal 构建产物由 Hub 进程托管**：生产模式不需要 Vite dev server；开发模式 Vite 5175 代理 `/api` 到 8780。

### 端口分配

| 服务 | 端口 | 可配置 |
|---|---|---|
| Hub（Portal + API） | 8780 | `HUB_PORT` |
| Portal dev（Vite） | 5175 | `PORTAL_DEV_PORT` |
| ISTS | 3000 | `ISTS_PORT` |
| BandReady 浏览器版 | 8765（占用则顺延） | 由 BandReady 自身决定 |

---

## 9. Windows 进程管理要点

- `spawn(cmd, argsArray, { shell: false, windowsHide: true, cwd, env })`；禁止字符串拼接
- 停止：先 `kill()`（SIGTERM 语义），3 秒未退再 `taskkill /PID <pid> /T /F`
- **只杀自己记录的 PID 树**；绝不按端口杀进程
- 端口预检：`net.createServer().listen(port)` 失败即 `EADDRINUSE`，给出“改配置或先关闭占用者”的提示
- 路径含中文/空格：`spawn` 传数组即可，但 `.cmd`/`.ps1` 需通过 `cmd.exe /c` 或 `node` 直接调用，注意 `windowsVerbatimArguments`
- 退出清理：`process.on('exit'|'SIGINT'|'SIGTERM')` + Hub 关闭时逆序停止子进程
- 日志：按模块写 `%APPDATA%\IELTS-Study-Hub\hub\logs\{ists,bandready}.log`，环形截断

---

## 10. 风险清单

| # | 风险 | 级别 | 处置 |
|---|---|---|---|
| 1 | BandReady `voice` 依赖 GPL-3.0（kokoro-onnx/phonemizer/espeakng） | 高（分发） | 第一版只发源码；二进制打包前法务审查；THIRD_PARTY_NOTICES 明示 |
| 2 | BandReady 为预发布（rc6），README 自述部分平台未验证 | 中 | 真机麦克风/WebRTC 列为发布验收项；文档标注 |
| 3 | 浏览器版端口 8765 可能被占用并顺延 | 中 | Hub 读取 `web.json` 取实际端口，不硬编码 |
| 4 | ISTS 默认监听 0.0.0.0 | 高（隐私） | Hub 强制 `-H 127.0.0.1`，并做启动后校验 |
| 5 | ISTS 数据默认在仓库目录 | 中 | Hub 配置到 `%APPDATA%`，文档迁移 |
| 6 | Google Fonts 构建依赖网络 | 中 | 文档说明；CI 允许网络或缓存字体 |
| 7 | better-sqlite3 原生模块编译 | 中 | setup 检测 VS Build Tools/预编译，失败给指引 |
| 8 | 两个 pnpm 版本并存 | 中 | 全部经 corepack 调用，不使用全局 pnpm 硬跑 |
| 9 | 用户在 BandReady 界面改 provider 会覆盖桥接配置 | 低（本机已遇到） | 文档提示；Hub 不代管 BandReady 的 provider 设置 |
| 10 | 移动端访问：ISTS/BandReady 均为本地回环 | 高（设计） | 第一版不做手机远程；如需，另做显式开关 + 鉴权，默认关闭 |

---

## 11. Phase 1 具体任务（可执行）

| 任务 | 产出 | 规则 |
|---|---|---|
| T1 仓库骨架 | `apps/`、`portal/`、`scripts/`、`docs/`、`.gitmodules`、`LICENSE`、`THIRD_PARTY_NOTICES.md`、`.gitignore` | 不复制上游源码 |
| T2 Submodule | 钉 ISTS `1088fe0`、BandReady `b2d67d4`；README 写 `--recurse-submodules` | 不改上游 |
| T3 Portal | Vite + React + TS；首页/设置/诊断/帮助；深绿+米白+橙；响应式；状态从 `/api/state` 读 | 只改 `portal/` |
| T4 Hub 服务 | Node 单进程：静态托管 + `/api/state`、`/api/start`、`/api/stop`、日志；端口预检；PID 追踪 | 只改 `scripts/` |
| T5 环境脚本 | `check-env.mjs`（Node/pnpm/corepack/Python/uv/git/依赖/端口）、`setup.mjs`、`dev.mjs`、`stop.mjs` | 只改 `scripts/` |
| T6 文档 | README、INSTALLATION、ARCHITECTURE、PRIVACY、TROUBLESHOOTING、CONTRIBUTING、SECURITY、CHANGELOG | 只改 `docs/` + 根文档 |
| T7 CI | portal install/typecheck/lint/build；scripts `node --test`；submodule 状态检查 | 不下载模型 |

**文件所有权（避免并发冲突）**：T3 只碰 `portal/`；T4/T5 只碰 `scripts/`；T6 只碰 `docs/`；T1/T2 由架构/集成负责人一次性完成。

---

## 12. 第一版验收标准（可测量）

1. `git clone --recurse-submodules` 成功后，`node scripts/check-env.mjs` 输出逐项 PASS/FAIL 与修复建议。
2. `node scripts/setup.mjs` 能完成 portal 依赖安装与 build；ISTS 依赖安装；不修改全局环境。
3. `node scripts/dev.mjs` 启动 Hub（8780）、ISTS（3000）、BandReady（8765），Portal 显示两者 `running`。
4. 关闭 Hub 后，由 Hub 启动的两个进程全部退出；非 Hub 启动的同名进程不被误杀。
5. 端口被占用时，Hub 给出明确报错与改端口指引，不崩溃、不静默换端口。
6. 路径含中文/空格的目录下，启动与停止均正常。
7. ISTS 实际监听 `127.0.0.1:3000`（用 `netstat` 验证），不监听 `0.0.0.0`。
8. BandReady 在浏览器完成一次**真实麦克风**口语回合（人工验收，记录截图/时间）。
9. `.gitignore` 验证：`data/*.db`、`uploads`、`.env.local`、`web.json`、模型文件均不在 `git status` 中。
10. CI 全绿：portal typecheck/lint/build + scripts 测试 + submodule 检查。

---

## 13. 待用户确认的决策

1. **BandReady 接入形态**：A. 官方浏览器版（uv 安装，约 800MB，推荐）/ B. 源码 dev 模式（固定端口，便于调试，需 Node+Python 依赖）。
2. **ISTS 数据目录**：A. 保持 `apps/ists/data`（与上游一致，简单）/ B. Hub 统一到 `%APPDATA%\IELTS-Study-Hub\ists`（更干净，需迁移说明，推荐）。
3. **Submodule 钉版**：A. 钉当前 main（ISTS `1088fe0` / BandReady `b2d67d4`，推荐）/ B. BandReady 钉发布 tag `v0.1.0-rc6`。

---

## 附：本次审计的实际核对命令

```powershell
# 上游提交
curl -s https://api.github.com/repos/aimerfeng/ists/commits?per_page=1
curl -s https://api.github.com/repos/Luxshan2000/ielts-prep/commits?per_page=1

# ISTS 端口默认值
cd apps/ists; node_modules/.bin/next start --help

# BandReady 浏览器版
Get-Content sidecar/bandready/launch.py   # PREFERRED_PORT = 8765, web.json
Get-Content scripts/dev.mjs               # 5273 / 8710 / dev-token / mock 默认
Get-Content sidecar/pyproject.toml        # requires-python >=3.11, voice extra
Get-Content sidecar/bandready/server/routes/system.py  # GET /health
```

> 本报告未对上游做任何修改；所有“待验证”项将在 Phase 5 用真实 Windows 环境、真实麦克风与平板浏览器完成验收后转为结论。
