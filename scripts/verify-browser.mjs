import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const cdpEndpoint = process.env.CDP_ENDPOINT ?? 'http://127.0.0.1:9222';
const appUrl = process.env.APP_URL ?? 'http://127.0.0.1:5173';
const screenshotDirectory = resolve('docs/screenshots');
const scenarioFile = resolve(process.env.SCENARIO_FILE ?? 'apps/server/data/scenarios.json');

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
  const loaded = await evaluate(`(${async function waitForPage() {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      if (document.querySelector('.trade-form')) return true;
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
    }
    return false;
  }})()`);
  if (!loaded) throw new Error('页面未加载调仓表单');
}

async function reloadAndWait() {
  await call('Page.reload', { ignoreCache: true });
  await waitForApp();
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
    const button = [...document.querySelectorAll('button')].find((item) => item.textContent?.trim() === buttonLabel);
    if (!button) throw new Error(`找不到按钮：${buttonLabel}`);
    button.click();
  }, label));
}

async function addOperation(side, symbol, quantity) {
  await setFormValue('.trade-form label:nth-child(1) select', side);
  await setFormValue('.trade-form label:nth-child(2) select', symbol);
  await setFormValue('.trade-form input[type="number"]', quantity);
  await clickButton('加入操作');
  await sleep(120);
}

async function submitSimulation() {
  await clickButton('提交模拟');
  const state = await evaluate(`(${async function waitForSimulation() {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const button = document.querySelector('.simulation-actions button');
      const alert = document.querySelector('.inline-error[role="alert"]');
      if (button && !button.disabled && (alert || document.querySelector('.comparison-area'))) {
        return {
          error: alert?.textContent?.trim() ?? null,
          hasComparison: Boolean(document.querySelector('.comparison-area')),
        };
      }
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
    }
    throw new Error('模拟请求未在预期时间内完成');
  }})()`);
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

async function captureScreenshot(fileName) {
  const metrics = await call('Page.getLayoutMetrics');
  const contentSize = metrics.cssContentSize ?? metrics.contentSize;
  const width = Math.min(Math.max(contentSize.width, 1), 1440);
  const height = Math.max(contentSize.height, 1);
  const screenshot = await call('Page.captureScreenshot', {
    format: 'png',
    fromSurface: true,
    captureBeyondViewport: true,
    clip: { x: 0, y: 0, width, height, scale: 1 },
  });
  await writeFile(resolve(screenshotDirectory, fileName), Buffer.from(screenshot.data, 'base64'));
}

function assertIncludes(text, expected, context) {
  if (!text.includes(expected)) throw new Error(`${context}缺少文本：${expected}`);
}

await mkdir(screenshotDirectory, { recursive: true });
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
  await captureScreenshot('overview.png');

  await addOperation('sell', 'A01', 100);
  await addOperation('buy', 'A02', 100);
  const successfulSimulation = await submitSimulation();
  const simulation = await readPageState();
  if (!successfulSimulation.hasComparison || simulation.operationCount !== 2) throw new Error('成功模拟未展示两笔操作和对比结果');
  assertIncludes(simulation.text, '行业集中度对比', '模拟结果');
  assertIncludes(simulation.text, '总资产守恒：100000.00 → 100000.00', '模拟结果');
  assertIncludes(simulation.text, '55.00%', '模拟结果');
  await captureScreenshot('simulation-comparison.png');

  await reloadAndWait();
  await addOperation('sell', 'A01', 100);
  await submitSimulation();
  await addOperation('sell', 'A01', 301);
  const failedSimulation = await submitSimulation();
  const error = await readPageState();
  assertIncludes(error.alertText ?? '', '持仓不足', '错误反馈');
  assertIncludes(error.alertText ?? '', '第 2 笔操作失败', '错误反馈');
  if (error.alertRole !== 'alert' || !failedSimulation.hasComparison || !error.hasStaleNote || !error.saveDisabled) {
    throw new Error('错误后未保留成功结果、过期提示或保存禁用状态');
  }
  await captureScreenshot('error-feedback.png');

  await reloadAndWait();
  await addOperation('sell', 'A01', 100);
  await addOperation('buy', 'A02', 100);
  await submitSimulation();
  await setFormValue('.scenario-save-row input', '浏览器交互验收方案');
  await clickButton('保存方案');
  const saved = await evaluate(`(${async function waitForSavedScenario() {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const message = document.querySelector('.inline-message')?.textContent?.trim() ?? '';
      if (message.includes('已保存')) return message;
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
    }
    throw new Error('方案未保存成功');
  }})()`);
  assertIncludes(saved, '浏览器交互验收方案', '方案保存');
  await clickButton('重新打开');
  const reopened = await evaluate(`(${async function waitForReopenedScenario() {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const message = document.querySelector('.inline-message')?.textContent?.trim() ?? '';
      if (message.includes('已重新打开')) return { message, operationCount: document.querySelectorAll('.operation-row').length, text: document.body.innerText };
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
    }
    throw new Error('方案未重新打开成功');
  }})()`);
  assertIncludes(reopened.message, '浏览器交互验收方案', '方案重开');
  if (reopened.operationCount !== 2) throw new Error('方案重开后的操作数量不是 2');
  assertIncludes(reopened.text, '总资产守恒：100000.00 → 100000.00', '方案重开');
  await captureScreenshot('scenario-reopened.png');

  console.log(JSON.stringify({ initial, simulation, error, reopened }, null, 2));
} finally {
  await writeFile(scenarioFile, '[]\n', 'utf8');
  if (socket) socket.close();
}
