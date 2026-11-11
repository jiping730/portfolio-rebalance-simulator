# 投资组合分析与调仓模拟

一个基于固定组合快照的全栈原型，用于展示组合概览、集中度告警、调仓模拟以及方案保存和重新打开。

## 环境要求

- Node.js 20+（本次验证使用 Node.js 22.23.1）
- npm 10+

## 安装与启动

在项目根目录执行：

```bash
npm install
```

分别打开两个终端：

```bash
# 终端一：后端 API，http://localhost:3000
npm --workspace apps/server run dev
```

```bash
# 终端二：前端页面，http://127.0.0.1:5173
npm --workspace apps/web run dev -- --host 127.0.0.1
```

Windows PowerShell 如果系统未配置 npm 命令别名，可将上述命令中的 `npm` 替换为 `npm.cmd`。

打开 <http://127.0.0.1:5173> 即可访问页面。前端通过 Vite 将 `/api` 请求代理到后端 3000 端口。

## 测试与构建

```bash
# 前后端全量自动化测试
npm test

# TypeScript 检查及前端生产构建
npm run build

# 需要本地 Chrome 以 9222 端口远程调试，并已启动前后端服务
node scripts/verify-browser.mjs
```

本项目不包含真实交易服务或生产服务器启动脚本；`build` 用于验证可编译和生成前端 `dist` 产物，开发环境按上面的两个命令启动即可。

## 核心流程

1. 加载固定组合快照，查看总资产、现金、持仓明细、行业分布和单标的/行业集中度提醒。
2. 在“调仓模拟”中选择买入或卖出、标的和正整数数量，按顺序加入操作列表。
3. 点击“提交模拟”，成功时查看原始/模拟组合、行业集中度对比、持仓变化和总资产守恒。
4. 如果校验失败，页面显示中文错误说明和“第 N 笔操作失败”；上一次成功结果会保留，但操作列表变化后会标记过期并禁用保存。
5. 模拟成功后填写方案名保存；方案只持久化组合/快照标识、名称、规范化操作、方案 ID 和创建时间，不持久化派生结果。
6. 方案列表可重新打开；服务重启后由 JSON 仓储读取方案，并基于当前固定快照重新计算结果。

可复现验收操作：卖出 A01 100 股，再买入 A02 100 股，预期现金为 25000.00、A02 为 500 股、科技行业占比为 55.00%，总资产仍为 100000.00。

## 项目结构

```text
apps/server/data/portfolio.json       固定组合快照
apps/server/data/scenarios.json       本地方案存储
apps/server/src/domain                金额、快照、计算和模拟领域逻辑
apps/server/src/api                   Express API 与统一错误处理
apps/server/src/repository            JSON 方案仓储
apps/web/src                          React 页面和 API 客户端
scripts/verify-browser.mjs            Chrome/CDP 交互验收与截图脚本
docs/screenshots                      关键页面验证截图
```

后端是计算唯一口径：金额使用整数分，集中度告警使用未舍入数值比较；现金计入总资产但不计入行业汇总。JSON 仓储当前采用单进程串行直接写入，不提供跨进程锁；重开时只使用持久化的元数据和操作重新计算。

## 验证材料

- [验证记录](VERIFY.md)：自动化测试、AC-01～AC-05、浏览器操作和已知问题。
- [设计与交付说明](DESIGN.md)：需求拆解、接口、关键取舍、AI 协作记录和复盘。
- [初始开工方案](PLAN.md)：开发前保留的范围、技术选择和验证计划。
- [概览截图](docs/screenshots/overview.png)
- [调仓结果截图](docs/screenshots/simulation-comparison.png)
- [错误反馈截图](docs/screenshots/error-feedback.png)
- [方案重开截图](docs/screenshots/scenario-reopened.png)

## 已知限制

- 当前是单用户、单组合、单币种 CNY 的固定快照原型，不包含登录、实时行情、真实下单、手续费税费或投资建议。
- 方案使用本地 JSON 文件保存；适合本地演示，不适合多进程或多实例并发写入。
- 当前支持保存和重新打开，不支持方案编辑、删除、导出，也没有独立的生产部署配置。
