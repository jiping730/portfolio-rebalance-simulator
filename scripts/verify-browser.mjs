import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const cdpEndpoint = process.env.CDP_ENDPOINT ?? 'http://127.0.0.1:9222';
const appUrl = process.env.APP_URL ?? 'http://localhost:5173';
const screenshotDirectory = resolve(process.env.SCREENSHOT_DIR ?? 'docs/screenshots');
const scenarioFile = resolve(process.env.SCENARIO_FILE ?? 'apps/server/data/scenarios.json');
const waitTimeoutAttempts = 200;
const pollIntervalMilliseconds = 100;

const selectors = {
  tradeSide: '[data-testid="trade-side"]',
  tradeSymbol: '[data-testid="trade-symbol"]',
  tradeQuantity: '[data-testid="trade-quantity"]',
  scenarioName: '[data-testid="scenario-name"]',
};

const targets = await (await fetch(`${cdpEndpoint}/json/list`)).json();
const target = targets.find((item) => item.type === 'page' && item.url.includes(new URL(appUrl).host))
  ?? targets.find((item) => item.type === 'page');

if (!target?.webSocketDebuggerUrl) {
  throw new Error('未找到可用的 Chrome 页面目标，请先启动带远程调试端口的 Chrome');
}

let socket;
let nextId = 1;
const pending = new Map();

function sleep(milliseconds) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds));
}

function call(method, params = {}) {
  const id = nextId++;
  return new Promise((resolvePromise, reject) => {
    pending.set(id, { resolve: resolvePromise, reject });
    socket.send(JSON.stringify({ id, method, params }));
  });
}

async function evaluate(expression) {
  const result = await call('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.exception?.description ?? '页面表达式执行失败');
  }
  return result.result?.value;
}

function pageFunction(functionBody, ...args) {
  return `(${functionBody.toString()})(${args.map((arg) => JSON.stringify(arg)).join(', ')})`;
}

async function waitForApp() {
  const loaded = await evaluate(pageFunction(async function waitForPage(maxAttempts, interval, requiredSelectors) {
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      if (requiredSelectors.every((selector) => document.querySelector(selector))) return true;
      await new Promise((resolvePromise) => setTimeout(resolvePromise, interval));
    }
    return false;
  }, waitTimeoutAttempts, pollIntervalMilliseconds, Object.values(selectors)));
  if (!loaded) throw new Error('页面未加载完整调仓表单');
}

async function reloadAndWait() {
  await call('Page.navigate', { url: appUrl });
  await waitForApp();
  await sleep(100);
}

async function setFormValue(selector, value) {
  await evaluate(pageFunction(function setValue(elementSelector, nextValue) {
    const element = document.querySelector(elementSelector);
    if (!element) throw new Error(`找不到表单元素：${elementSelector}`);
    const prototype = element instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    const descriptor = Object.getOwnPropertyDescriptor(prototype, 'value');
    descriptor.set.call(element, nextValue);
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
  }, selector, String(value)));
}

async function clickButton(label) {
  await evaluate(pageFunction(function clickButtonByLabel(buttonLabel) {
    const button = [...document.querySelectorAll('button')].find((item) =>
      item.getAttribute('aria-label') === buttonLabel || item.textContent?.trim() === buttonLabel,
    );
    if (!button) throw new Error(`找不到按钮：${buttonLabel}`);
    button.click();
  }, label));
}

async function addOperation(side, symbol, quantity) {
  await setFormValue(selectors.tradeSide, side);
  await setFormValue(selectors.tradeSymbol, symbol);
  await setFormValue(selectors.tradeQuantity, quantity);
  await clickButton('加入操作');
  await sleep(200);
}

async function submitSimulation() {
  await clickButton('提交模拟');
  const state = await evaluate(pageFunction(async function waitForSimulation(maxAttempts, interval) {
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      const button = document.querySelector('.simulation-actions button');
      const alert = document.querySelector('.inline-error[role="alert"]');
      if (button && !button.disabled && (alert || document.querySelector('.comparison-area'))) {
        return {
          error: alert?.textContent?.trim() ?? null,
          hasComparison: Boolean(document.querySelector('.comparison-area')),
        };
      }
      await new Promise((resolvePromise) => setTimeout(resolvePromise, interval));
    }
    throw new Error('模拟请求未在预期时间内完成');
  }, waitTimeoutAttempts, pollIntervalMilliseconds));
  return state;
}

async function readPageState() {
  return evaluate(`(${() => ({
    text: document.body.innerText,
    alertText: document.querySelector('.inline-error[role="alert"]')?.textContent?.trim() ?? null,
    alertRole: document.querySelector('.inline-error[role="alert"]')?.getAttribute('role') ?? null,
    operationCount: document.querySelectorAll('.operation-row').length,
    hasComparison: Boolean(document.querySelector('.comparison-area')),
    hasStaleNote: Boolean(document.querySelector('.stale-note')),
    saveDisabled: document.querySelector('.scenario-save-row button')?.disabled ?? null,
  })})()`);
}

async function captureContentRange(fileName, startSelector, endSelector) {
  const range = await evaluate(pageFunction(function getContentRange(firstSelector, lastSelector, padding) {
    const first = firstSelector ? document.querySelector(firstSelector)?.getBoundingClientRect() : { top: 0, left: 0 };
    const last = document.querySelector(lastSelector)?.getBoundingClientRect();
    if (!last) throw new Error(`找不到截图范围元素：${lastSelector}`);
    const scrollX = window.scrollX;
    const scrollY = window.scrollY;
    const documentWidth = Math.max(document.documentElement.scrollWidth, document.body.scrollWidth);
    const left = Math.max(0, (first?.left ?? 0) + scrollX - padding);
    const top = Math.max(0, (first?.top ?? 0) + scrollY - padding);
    const right = Math.min(documentWidth, last.right + scrollX + padding);
    const bottom = Math.min(document.documentElement.scrollHeight, last.bottom + scrollY + padding);
    return { x: left, y: top, width: Math.max(1, right - left), height: Math.max(1, bottom - top) };
  }, startSelector, endSelector, 18));
  const metrics = await call('Page.getLayoutMetrics');
  const contentSize = metrics.cssContentSize ?? metrics.contentSize;
  const width = Math.min(Math.max(range.width, 1), Math.max(contentSize.width, 1), 1440);
  const height = Math.min(Math.max(range.height, 1), Math.max(contentSize.height, 1));
  const screenshot = await call('Page.captureScreenshot', {
    format: 'png',
    fromSurface: true,
    captureBeyondViewport: true,
    clip: { x: range.x, y: range.y, width, height, scale: 1 },
  });
  await writeFile(resolve(screenshotDirectory, fileName), Buffer.from(screenshot.data, 'base64'));
}

function assertIncludes(text, expected, context) {
  if (!text.includes(expected)) throw new Error(`${context}缺少文本：${expected}`);
}

await mkdir(screenshotDirectory, { recursive: true });
const originalScenarioContent = await readFile(scenarioFile, 'utf8').catch(() => '[]\n');
await writeFile(scenarioFile, '[]\n', 'utf8');

try {
  socket = new WebSocket(target.webSocketDebuggerUrl);
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
    const resolver = pending.get(message.id);
    if (!resolver) return;
    pending.delete(message.id);
    if (message.error) resolver.reject(new Error(message.error.message));
    else resolver.resolve(message.result);
  });
  await new Promise((resolvePromise, reject) => {
    socket.addEventListener('open', resolvePromise, { once: true });
    socket.addEventListener('error', reject, { once: true });
  });
  await call('Page.enable');
  await call('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  await call('Page.navigate', { url: appUrl });
  await waitForApp();

  const initial = await readPageState();
  assertIncludes(initial.text, '2 项超限', '初始页面');
  assertIncludes(initial.text, '星河科技', '初始页面');
  assertIncludes(initial.text, '科技行业', '初始页面');
  await captureContentRange('ac-01-overview.png', null, '.alert-panel');

  await addOperation('sell', 'A01', 100);
  const boundarySimulation = await submitSimulation();
  const boundary = await readPageState();
  if (!boundarySimulation.hasComparison || boundary.operationCount !== 1) throw new Error('AC-02 未展示一笔卖出操作和对比结果');
  assertIncludes(boundary.text, '现金 ¥30000.00 · 0 项提醒', 'AC-02');
  assertIncludes(boundary.text, '持仓明细对比', 'AC-02');
  assertIncludes(boundary.text, 'A01 · 星河科技', 'AC-02');
  assertIncludes(boundary.text, '30.00%', 'AC-02');
  assertIncludes(boundary.text, '50.00%', 'AC-02');
  await captureContentRange('ac-02-threshold-boundary.png', '.simulation-panel', '.comparison-area');

  await addOperation('buy', 'A02', 100);
  const successfulSimulation = await submitSimulation();
  const simulation = await readPageState();
  if (!successfulSimulation.hasComparison || simulation.operationCount !== 2) throw new Error('AC-03 未展示两笔操作和对比结果');
  assertIncludes(simulation.text, '行业集中度对比', 'AC-03');
  assertIncludes(simulation.text, '总资产守恒：100000.00 → 100000.00', 'AC-03');
  assertIncludes(simulation.text, '现金 ¥25000.00', 'AC-03');
  assertIncludes(simulation.text, '55.00%', 'AC-03');
  assertIncludes(simulation.text, '持仓明细对比', 'AC-03');
  assertIncludes(simulation.text, '模拟占比', 'AC-03');
  assertIncludes(simulation.text, '占比变化', 'AC-03');
  assertIncludes(simulation.text, '-10.00%', 'AC-03');
  assertIncludes(simulation.text, '25.00%', 'AC-03');
  assertIncludes(simulation.text, '模拟状态', 'AC-03');
  await captureContentRange('ac-03-continuous-operations.png', '.simulation-panel', '.comparison-area');

  await reloadAndWait();
  await addOperation('buy', 'A01', 201);
  const failedCashSimulation = await submitSimulation();
  const error = await readPageState();
  assertIncludes(error.alertText ?? '', '现金不足', 'AC-04');
  assertIncludes(error.alertText ?? '', '第 1 笔操作失败', 'AC-04');
  if (error.alertRole !== 'alert' || failedCashSimulation.hasComparison || error.hasComparison) {
    throw new Error('AC-04 现金不足未被拒绝或错误后产生了模拟结果');
  }
  await captureContentRange('ac-04-invalid-operation.png', '.workspace-layout', '.scenario-list');

  await reloadAndWait();
  await addOperation('sell', 'A01', 401);
  const failedHoldingSimulation = await submitSimulation();
  const holdingError = await readPageState();
  assertIncludes(holdingError.alertText ?? '', '持仓不足', 'AC-04 超卖');
  assertIncludes(holdingError.alertText ?? '', '第 1 笔操作失败', 'AC-04 超卖');
  if (failedHoldingSimulation.hasComparison || holdingError.hasComparison) throw new Error('AC-04 超卖未被拒绝');

  await reloadAndWait();
  await addOperation('sell', 'A01', 100);
  const previousSuccessfulSimulation = await submitSimulation();
  await addOperation('sell', 'A01', 301);
  const failedSecondSimulation = await submitSimulation();
  const secondOperationError = await readPageState();
  assertIncludes(secondOperationError.alertText ?? '', '持仓不足', 'AC-04 第二笔失败');
  assertIncludes(secondOperationError.alertText ?? '', '第 2 笔操作失败', 'AC-04 第二笔失败');
  if (!previousSuccessfulSimulation.hasComparison || !failedSecondSimulation.hasComparison || !secondOperationError.hasStaleNote || !secondOperationError.saveDisabled) {
    throw new Error('AC-04 第二笔失败未保留上次结果或禁用保存');
  }

  await reloadAndWait();
  for (const invalidQuantity of [0, -1, 1.5]) {
    await setFormValue(selectors.tradeQuantity, invalidQuantity);
    await clickButton('加入操作');
    const quantityError = await readPageState();
    assertIncludes(quantityError.alertText ?? '', '交易数量必须为正整数', `AC-04 数量 ${invalidQuantity}`);
  }

  await reloadAndWait();
  await addOperation('sell', 'A01', 100);
  await addOperation('buy', 'A02', 100);
  const persistenceSimulation = await submitSimulation();
  const persistence = await readPageState();
  if (!persistenceSimulation.hasComparison || persistence.operationCount !== 2) throw new Error('AC-05 保存前模拟未成功');
  assertIncludes(persistence.text, '现金 ¥25000.00', 'AC-05');
  assertIncludes(persistence.text, '总资产守恒：100000.00 → 100000.00', 'AC-05');
  await setFormValue(selectors.scenarioName, 'AC-05 持久化验收');
  await clickButton('保存方案');
  const saved = await evaluate(pageFunction(async function waitForSavedScenario(maxAttempts, interval) {
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      const message = document.querySelector('.inline-message')?.textContent?.trim() ?? '';
      if (message.includes('已保存')) return message;
      await new Promise((resolvePromise) => setTimeout(resolvePromise, interval));
    }
    throw new Error('方案未保存成功');
  }, waitTimeoutAttempts, pollIntervalMilliseconds));
  assertIncludes(saved, 'AC-05 持久化验收', 'AC-05 方案保存');
  await clickButton('重新打开');
  const reopened = await evaluate(pageFunction(async function waitForReopenedScenario(maxAttempts, interval) {
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      const message = document.querySelector('.inline-message')?.textContent?.trim() ?? '';
      if (message.includes('已重新打开')) return { message, operationCount: document.querySelectorAll('.operation-row').length, text: document.body.innerText };
      await new Promise((resolvePromise) => setTimeout(resolvePromise, interval));
    }
    throw new Error('方案未重新打开成功');
  }, waitTimeoutAttempts, pollIntervalMilliseconds));
  assertIncludes(reopened.message, 'AC-05 持久化验收', 'AC-05 方案重开');
  if (reopened.operationCount !== 2) throw new Error('方案重开后的操作数量不是 2');
  assertIncludes(reopened.text, '总资产守恒：100000.00 → 100000.00', '方案重开');
  assertIncludes(reopened.text, 'A01 · 星河科技', 'AC-05 方案重开');
  assertIncludes(reopened.text, 'A02 · 云帆软件', 'AC-05 方案重开');
  await captureContentRange('ac-05-scenario-reopened.png', '.comparison-area', '.scenario-list');

  console.log(JSON.stringify({ initial, boundary, simulation, error, reopened }, null, 2));
} finally {
  await writeFile(scenarioFile, originalScenarioContent, 'utf8');
  if (socket) socket.close();
}
