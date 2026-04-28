# Auto-Approve Deploy Gates

[English](README.md) | **中文**

一个 Tampermonkey 用户脚本，自动审批 GitHub Actions 部署门禁并跳过等待计时器——告别多环境部署流水线中的手动点击。

## 功能特性

- **自动审批部署门禁** — 通过 GitHub REST API 检测待审批的部署并自动批准
- **跳过等待计时器** — 通过 DOM 交互绕过环境等待计时器（API Token 无法实现的操作）
- **状态持久化** — 页面刷新后自动恢复监控状态
- **宽限期** — 容忍"重新运行所有作业"的延迟（90秒），不会误判为已完成
- **本地日志存储** — 可选将每次运行的日志保存到浏览器存储，支持下载
- **侧边面板** — 暗色主题、可折叠的侧边面板，实时显示状态和执行报告

## 安装

1. 安装 [Tampermonkey](https://www.tampermonkey.net/) 浏览器扩展
2. 点击下方链接安装用户脚本：

   **[安装 auto-approve-deploy.user.js](https://github.com/TD-Yofun/talkdesk-auto-deploy/raw/main/auto-approve-deploy.user.js)**

3. 首次使用时，点击 **🔑 Token** 设置 GitHub 个人访问令牌（终端运行 `gh auth token` 获取）

## 使用方法

1. 打开任意 GitHub Actions 运行页面（`github.com/{owner}/{repo}/actions/runs/{id}`）
2. 侧边面板自动出现在右侧
3. 点击 **▶ Start** 开始监控
4. 脚本将：
   - 每 15 秒（可配置）轮询运行状态
   - 自动审批待处理的部署门禁
   - 尝试通过页面 DOM 交互跳过等待计时器
   - 运行完成后自动停止并生成执行报告

### 控件说明

| 控件 | 说明 |
|------|------|
| **▶ Start / ⏹ Stop** | 开始/停止监控 |
| **⏱ Interval** | 轮询间隔（5–300 秒） |
| **Approve** | 启用/禁用自动审批 |
| **Skip timers** | 启用/禁用跳过等待计时器 |
| **💾 Log** | 启用本地日志持久化 |
| **📥** | 下载当前运行的日志文件 |
| **🔑 Token** | 设置 GitHub 个人访问令牌 |

> 执行期间所有配置控件被禁用，防止误操作。

### 面板交互

- 点击折叠标签展开/收起面板
- 面板固定在页面右侧，全高度显示

## Token 权限要求

GitHub Token 需要以下权限：

- `repo` — 读取工作流运行和审批部署所需

## 跳过等待计时器的工作原理

脚本按顺序尝试 3 种方式：

1. **点击"Start all waiting jobs"按钮** → 勾选对话框中的环境复选框 → 点击确认按钮
2. **提交 skip 表单**，注入 `gate_request[]` 字段
3. **手动 POST 请求**，使用从页面提取的 CSRF Token

此功能使用浏览器会话 Cookie（而非 API Token），因此只能在浏览器内运行。

## 许可证

MIT
