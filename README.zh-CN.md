# Auto-Approve Deploy Gates

[English](README.md) | **中文**

一个 Tampermonkey 用户脚本，自动批准 GitHub Actions 的部署门控——再也不用手动一环一环地批准多环境部署流水线。

**无需 GitHub Token。** 脚本通过 DOM 检测 break-glass 按钮，并基于你浏览器现有的登录会话点过确认弹窗。

使用 **Vite + TypeScript** 构建，产出 `build/auto-approve-deploy.user.js`（开发版）和 `build/auto-approve-deploy.min.user.js`（压缩版）两个打包后的 userscript。`build/` 目录已被 gitignore —— 构建产物由 CI 生成并发布到 GitHub Releases。

## 功能特性

- **纯 DOM 自动批准器** —— 优先检测 GitHub 的 "Review deployments"，勾选全部待部署环境后点击 "Approve and deploy"；找不到时再回退到 "Start all waiting jobs"
- **仅对 `Deploy (PRD)` 生效** —— 仅当页面头部 workflow label 匹配 `Deploy (PRD)`（子串匹配，容忍 emoji 前缀）时才激活
- **自动停止 + 总结报告** —— 从页面状态徽标读取 workflow 结论（`success`/`failure`/`cancelled`/`timed_out`/`skipped`），命中终态后自动停止并生成报告
- **桌面通知** —— `GM_notification` 在 run 进入终态时弹出系统通知（点击聚焦标签页）
- **报告复制为 Markdown** —— 一键将执行报告复制到剪贴板
- **暂停 / 恢复** —— 在不丢失计数器和会话状态的情况下暂停监控
- **后台标签页抗节流** —— 使用专用 Web Worker 调度轮询，避免浏览器将后台标签页节流到 ≥1 分钟
- **看门狗自动刷新** —— 若 10 分钟无进展则自动 reload 页面，并基于 session 恢复监控
- **跨刷新持久化** —— 通过 `wasRunning()` 检测，刷新后自动恢复计数器、事件时间线和日志
- **日志始终持久化** —— 每个 run 的日志缓冲区跨刷新保留，可随时下载 `aad-run-<runId>.log`
- **My PRs 侧栏区块** —— 在 `github.com/` 首页的 Top repositories 下方显示我创建的 Open PR 与我已 Review 的 Open PR；点击会在新标签页打开
- **组织仓库搜索** —— 在 `github.com/` 首页加载你所属的组织，并按关键词搜索组织仓库；结果点击后在新标签页打开
- **bfcache 安全** —— 通过 `pageshow.persisted` 在浏览器前进/后退后重新初始化面板
- **全局错误捕获** —— `window.error` 和 `unhandledrejection` 会输出到面板日志
- **版本检查** —— 与最新公开 userscript release asset 比对，过期脚本会被显眼地拦截并提供安装链接
- **多标签页安全** —— 每个标签页（不同 `runId`）独立运行，所有状态按 `runId` 隔离

## 安装

1. 安装 [Tampermonkey](https://www.tampermonkey.net/) 浏览器扩展
2. 点击下方链接安装 userscript：

   - **[auto-approve-deploy.min.user.js](https://github.com/TD-Yofun/github-auto-deploy/releases/latest/download/auto-approve-deploy.min.user.js)**（推荐）
   - [auto-approve-deploy.user.js](https://github.com/TD-Yofun/github-auto-deploy/releases/latest/download/auto-approve-deploy.user.js)（未压缩，方便调试）

3. 完成——无需 token、无需配置。

## 使用方法

1. 打开一个 Deploy (PRD) workflow run（`github.com/{owner}/{repo}/actions/runs/{id}`）
2. 页面右侧会出现侧边面板
3. 点击 **▶ Start** 开始监控
4. 脚本将会：
   - 优先监听 DOM 中的 "Review deployments"，勾选全部待部署环境并批准；缺失时回退到 "Start all waiting jobs"
   - 每 `interval` 秒兜底轮询一次
   - 当 workflow 进入终态时自动停止并显示总结报告
   - 弹出桌面通知告知结果

### 控件

| 控件 | 说明 |
|------|------|
| **▶ Start / ⏹ Stop** | 切换监控状态 |
| **⏸ Pause / ▶ Resume** | 暂停（不丢失计数器），仅运行时可见 |
| **⏱ Interval** | 轮询间隔秒数（5–300，默认 15） |
| **💾 Log** | 切换日志文件提示显示（无论开关如何，日志始终持久化） |
| **📥** | 下载当前 run 的日志文件（`aad-run-<runId>.log`） |
| **📋 Copy MD** | （在总结报告中）将执行报告复制为 Markdown |

> 运行期间 Interval 和 Log 控件被禁用，防止误改。

### 面板交互

- 点击右侧边缘的 **◀ AAD** 标签展开/收起面板
- 标题栏的 **▶** 按钮收起面板

### My PRs 侧栏区块

在 GitHub 首页，Top repositories 下方的独立区块会通过当前已登录的 GitHub 会话加载我创建的 Open PR 和我已 Review 的 Open PR。它使用当前 GitHub 登录账号作为 author/reviewer 过滤条件，首次进入首页时加载，之后仅在点击刷新按钮时重新加载。

### 组织仓库搜索

首页侧栏会优先读取 GitHub 首页仪表盘上下文切换器中的组织列表（`dialog#switch_dashboard_context_left_column-dialog`），并以 `/settings/organizations` 和 `/user/orgs` 作为回退。没有组织时隐藏整个搜索区域；只有一个组织时自动使用该组织并隐藏下拉框；多个组织时才显示组织选择。输入仓库关键词并点击 **Search**，脚本会使用 GitHub 仓库搜索条件（`org:<组织> <关键词>`）展示结果，点击后在新标签页打开仓库。组织信息和搜索结果均通过当前浏览器登录会话请求，不保存也不需要 Token。

## 工作原理

```
                  ┌────────────────────┐
                  │   页面加载（任意    │
                  │  github.com 页面） │
                  └─────────┬──────────┘
                            │
            ┌───────────────▼───────────────┐
            │ URL 是 /…/actions/runs/<id>?  │
            │    且头部 label 匹配          │
            │       /Deploy\s*\(PRD\)/      │
            └─┬─────────────────────────────┘
                                  ┌──────────▼───────────────┐
                                  │ 构建侧边面板 + 日志存储；  │
                                  │ 恢复日志；若上次在运行    │
                                  │ 则自动恢复                │
                                  └──────────┬────────────────┘
                                             │
                                  ┌──────────▼──────────────┐
                                  │ 用户点击 ▶ Start        │
                                  └──────────┬──────────────┘
                                             │
                            ┌────────────────▼────────────────┐
                            │ MutationObserver + Worker 调度   │
                            │ 轮询循环（每 interval 秒）       │
                            └────────────────┬────────────────┘
                                             │
                       ┌─────────────────────┼─────────────────────┐
                       │                     │                     │
            ┌──────────▼──────────┐  ┌───────▼───────┐   ┌─────────▼──────────┐
            │ "Review deployments"│  │  Run 命中     │   │ 10 分钟无进展？     │
            │ 或旧版按钮出现？     │  │  终态？       │   │ （看门狗）          │
            └──────────┬──────────┘  └───────┬───────┘   └─────────┬──────────┘
                       │ 是                  │ 是                  │ 是
            ┌──────────▼──────────┐  ┌───────▼─────────────┐  ┌─────────────┐
            │ 点击 → 勾选全部环境  │  │ 停止 + 生成总结报告 │  │ location.   │
            │ → 批准已启用的对话框 │  │ → 桌面通知          │  │ reload();   │
            └──────────┬──────────┘  └─────────────────────┘  │ 自动恢复    │
                       │                                       └─────────────┘
              ┌────────▼────────┐
              │ 冷却 5s → 继续  │
              │ 轮询             │
              └─────────────────┘
```

## 部署批准实现

脚本优先采用 GitHub 当前的审核流程：

1. **点击 "Review deployments"** → 等待 `js-gates-dialog` 对话框 → 勾选全部 `gate_request[]` 复选框 → 等待 **"Approve and deploy"** 解除禁用 → 点击批准
2. 找不到审核按钮时，回退到 **"Start all waiting jobs"** 及其确认对话框
3. 仅当旧对话框无法完成时，才尝试既有 DOM 回退策略：程序化表单提交，或使用页面 CSRF token 发起同源 POST

三种方式都依赖你已有的浏览器会话 cookie——不需要 API token。

## 开发

### 前置条件

- [Node.js](https://nodejs.org/) >= 18.12
- Corepack（随受支持的 Node.js 版本提供）

### 安装依赖

```bash
corepack enable
yarn install
```

### 构建

```bash
yarn build        # 同时构建 dev 和压缩版
yarn build:dev    # 仅 dev
yarn build:prod   # 仅压缩版
```

### Watch 模式

```bash
yarn start            # 提供本地 userscript，直接在 GitHub 页面调试
yarn dev              # yarn start 的别名
yarn dev:build        # 改动时重新构建开发版 userscript
yarn dev:all          # 改动时同时重新构建两份
yarn preview:ui       # 本地预览 My PRs 小部件：http://127.0.0.1:5173
```

要直接在 GitHub 页面调试，运行 `yarn start` 后，首次打开并安装本地开发脚本：
[http://127.0.0.1:5173/__vite-plugin-monkey.install.user.js](http://127.0.0.1:5173/__vite-plugin-monkey.install.user.js)。
之后修改源码并刷新匹配的 GitHub 页面即可生效。

### 项目结构

```
src/
  main.ts              ← 入口 —— 串联模块、页面检测、生命周期
  core/
    config.ts          ← 持久化配置（interval、saveLog 提示、panelVisible）
    state.ts           ← 运行时状态类型 + 看门狗常量
    log-store.ts       ← 始终开启的日志持久化（批量缓冲、防抖写盘）
    session.ts         ← 跨刷新的 session 持久化
    scheduler.ts       ← 基于 Web Worker 的定时器（规避后台标签页节流）
    pull-requests.ts   ← 基于已登录 GitHub HTML 的 PR 查询
    organization-repositories.ts ← 组织成员关系和仓库搜索
    version-check.ts   ← 与最新 GitHub Release 比对，结果缓存
  api/
    skip-timers.ts     ← MutationObserver + 3 种 DOM 点击策略
  ui/
    styles.ts          ← 通过 GM_addStyle 注入编译后的 Sass
    styles.scss        ← 面板和侧栏的 Sass 样式
    ui.ts              ← 面板构建、渲染、事件绑定、总结 + Markdown 导出
    pr-overview.ts     ← GitHub 首页 PR 小部件
    org-repo-search.ts  ← GitHub 首页组织仓库搜索
  utils/
    helpers.ts         ← ts()、esc()、formatDuration()
    url.ts             ← URL 解析 + Deploy (PRD) 页面检测
```

### 构建产物

| 文件 | 说明 |
|------|------|
| `build/auto-approve-deploy.user.js` | 开发版 —— 未压缩，可读（gitignored）|
| `build/auto-approve-deploy.min.user.js` | 生产版 —— JS 压缩 + CSS/HTML 模板压缩（gitignored）|

### 发布流程

本地：`yarn release -- patch`（release-it）升版本号、构建、提交、打 tag。然后 `git push --follow-tags origin main` 触发 `.github/workflows/release.yml`，自动创建 GitHub Release 并上传两份 `.user.js` 产物。完整流程见 `.agents/skills/release/SKILL.md`。

## License

MIT
