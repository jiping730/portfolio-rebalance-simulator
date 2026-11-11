# 投资组合分析与调仓模拟

一个基于固定组合快照的全栈原型，用于展示组合概览、集中度告警、调仓模拟以及方案保存和重新打开。

## 快速开始

### 1. 环境要求

- Node.js 20 或更高版本（本次验证使用 Node.js 22.23.1）
- npm 10 或更高版本
- Windows PowerShell 如果系统未配置 `npm` 命令别名，请将命令中的 `npm` 替换为 `npm.cmd`

### 2. 安装依赖

在项目根目录执行：

```bash
npm install
```

项目使用 npm workspaces，依赖会同时安装到 `apps/server` 和 `apps/web`。

### 3. 初始化

本项目不需要数据库迁移、账号配置或环境变量初始化。首次运行前确认方案文件存在且为空数组：

```text
apps/server/data/scenarios.json
```

其初始内容应为：

```json
[]
```

组合快照已内置于 `apps/server/data/portfolio.json`，无需导入外部数据。

### 4. 启动服务

分别打开两个终端，并都在项目根目录执行：

终端一，启动后端 API：

```bash
npm --workspace apps/server run dev
```

- 后端地址：<http://127.0.0.1:3000>
- 健康检查：<http://127.0.0.1:3000/health>

终端二，启动前端页面：

```bash
npm --workspace apps/web run dev -- --host 127.0.0.1
```

### 5. 访问应用

打开：<http://127.0.0.1:5173>

前端通过 Vite 将 `/api` 请求代理到后端 `3000` 端口。页面加载后应看到：

- 组合总资产：`¥100000.00`
- 现金余额：`¥20000.00`
- 初始集中度提醒：`2 项超限`

## 测试与构建

```bash
# 前后端全量自动化测试
npm test

# TypeScript 检查及前端生产构建
npm run build

# 需要本地 Chrome 以 9222 端口远程调试，并已启动前后端服务
npm run verify:browser
```

本项目不包含真实交易服务或生产服务器启动脚本；`build` 用于验证可编译和生成前端 `dist` 产物，开发环境按上面的两个命令启动即可。

浏览器验收需要 Chrome/Chromium 以远程调试端口 `9222` 启动；脚本会实际操作页面、生成四张截图，并在结束时恢复方案文件原内容。

## 核心操作流程

1. 加载固定组合快照，查看总资产、现金、持仓明细、行业分布和集中度提醒。
2. 在“调仓模拟”中选择买入或卖出、标的和正整数数量，点击“加入操作”。
3. 按需要加入多笔操作，列表中的序号表示实际执行顺序。
4. 点击“提交模拟”，查看原始/模拟现金、持仓变化、行业集中度对比和总资产守恒。
5. 如果校验失败，页面显示中文错误说明和“第 N 笔操作失败”；上一次成功结果会保留，当前操作列表会标记为过期并禁止保存。

### 保存和重新打开方案

1. 完成一次成功模拟后，在“保存当前方案”区域输入方案名称。
2. 点击“保存方案”，方案列表中会出现该方案及操作数量。
3. 在“已保存方案”中点击“重新打开”。
4. 页面会恢复该方案的操作列表，并通过后端基于固定快照重新计算模拟结果。
5. 如需验证重启恢复：停止后端服务，重新执行后端启动命令，刷新页面后再次点击“重新打开”；方案来自 `apps/server/data/scenarios.json`，不依赖浏览器本地状态。

可复现验收操作：卖出 A01 100 股，再买入 A02 100 股，预期现金为 `25000.00`、A01 为 `300` 股、A02 为 `500` 股、科技行业占比为 `55.00%`，总资产仍为 `100000.00`。

## 项目结构

```text
apps/server/data/portfolio.json       固定组合快照
apps/server/data/scenarios.json       本地方案存储
apps/server/src/domain                金额、快照、计算和模拟领域逻辑
apps/server/src/api                   Express API 与统一错误处理
apps/server/src/repository            JSON 方案仓储
apps/web/src                          React 页面和 API 客户端
scripts/verify-browser.mjs            Chrome/CDP 交互验收与截图脚本
docs/PLAN.md                          开发前初始方案
docs/DESIGN.md                        设计与交付说明
docs/VERIFY.md                        验证记录
docs/screenshots                      关键页面验证截图
```

后端是计算唯一口径：金额使用整数分，集中度告警使用未舍入数值比较；现金计入总资产但不计入行业汇总。JSON 仓储当前采用单进程串行直接写入，不提供跨进程锁；重开时只使用持久化的元数据和操作重新计算。

## 验证材料

- [验证记录](docs/VERIFY.md)：自动化测试、AC-01～AC-05、浏览器操作和已知问题。
- [设计与交付说明](docs/DESIGN.md)：需求拆解、接口、关键取舍、AI 协作记录和复盘。
- [初始开工方案](docs/PLAN.md)：开发前保留的范围、技术选择和验证计划。
- [概览截图](docs/screenshots/overview.png)
- [调仓结果截图](docs/screenshots/simulation-comparison.png)
- [错误反馈截图](docs/screenshots/error-feedback.png)
- [方案重开截图](docs/screenshots/scenario-reopened.png)

## 已知限制

- 当前是单用户、单组合、单币种 CNY 的固定快照原型，不包含登录、实时行情、真实下单、手续费税费或投资建议。
- 方案使用本地 JSON 文件保存；适合本地演示，不适合多进程或多实例并发写入。
- 当前支持保存和重新打开，不支持方案编辑、删除、导出，也没有独立的生产部署配置。
