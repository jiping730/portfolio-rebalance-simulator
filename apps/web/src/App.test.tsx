import { fireEvent, render, screen, waitFor, cleanup, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PortfolioAnalysis, PortfolioOverview, ScenarioDetail, SimulationResult } from './api';
import App from './App';

const fetchMock = vi.fn();

const initialAnalysis: PortfolioAnalysis = {
  summary: {
    totalAsset: '100000.00',
    cash: '20000.00',
    holdingCount: 2,
    alerts: [
      { type: 'instrument', key: 'A01', label: '星河科技', ratioPercent: '40.00', thresholdPercent: '30.00' },
      { type: 'industry', key: '科技', label: '科技行业', ratioPercent: '60.00', thresholdPercent: '50.00' },
    ],
  },
  instruments: [
    { symbol: 'A01', name: '星河科技', industry: '科技', price: '100.00', quantity: 400, marketValue: '40000.00', ratioPercent: '40.00', isOverThreshold: true, thresholdPercent: '30.00' },
    { symbol: 'A02', name: '云帆软件', industry: '科技', price: '50.00', quantity: 400, marketValue: '20000.00', ratioPercent: '20.00', isOverThreshold: false, thresholdPercent: '30.00' },
  ],
  industries: [
    { industry: '科技', marketValue: '60000.00', ratioPercent: '60.00', isOverThreshold: true, thresholdPercent: '50.00' },
  ],
};

const portfolio: PortfolioOverview = {
  portfolio: {
    portfolioId: 'DEMO-001',
    snapshotId: 'SNAP-20261102',
    name: '演示组合',
    currency: 'CNY',
    snapshotAt: '2026-11-02T15:00:00+08:00',
    cash: '20000.00',
  },
  ...initialAnalysis,
};

const simulatedAnalysis: PortfolioAnalysis = {
  summary: {
    totalAsset: '100000.00',
    cash: '25000.00',
    holdingCount: 2,
    alerts: [
      { type: 'industry', key: '科技', label: '科技行业', ratioPercent: '55.00', thresholdPercent: '50.00' },
    ],
  },
  instruments: [
    { ...initialAnalysis.instruments[0], quantity: 300, marketValue: '30000.00', ratioPercent: '30.00', isOverThreshold: false },
    { ...initialAnalysis.instruments[1], quantity: 500, marketValue: '25000.00', ratioPercent: '25.00', isOverThreshold: false },
  ],
  industries: [
    { industry: '科技', marketValue: '55000.00', ratioPercent: '55.00', isOverThreshold: true, thresholdPercent: '50.00' },
  ],
};

const simulation: SimulationResult = {
  operations: [
    { order: 1, side: 'sell', symbol: 'A01', quantity: 100 },
    { order: 2, side: 'buy', symbol: 'A02', quantity: 100 },
  ],
  original: initialAnalysis,
  simulated: simulatedAnalysis,
  invariant: {
    originalTotalAsset: '100000.00',
    simulatedTotalAsset: '100000.00',
    isPreserved: true,
  },
};

const scenario: ScenarioDetail = {
  scenarioId: 'SCN-001',
  name: '浏览器交互验收方案',
  portfolioId: 'DEMO-001',
  snapshotId: 'SNAP-20261102',
  operations: simulation.operations,
  createdAt: '2026-11-11T07:00:00.000Z',
  result: { ...simulatedAnalysis, invariant: simulation.invariant },
};

function response(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

function setupApi(previews: unknown[] = [simulation]) {
  let previewIndex = 0;
  let scenarioListCalls = 0;
  fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    if (url === '/api/portfolio') return response(portfolio);
    if (url === '/api/scenarios' && method === 'GET') {
      scenarioListCalls += 1;
      return response({ data: scenarioListCalls > 1 ? [{ ...scenario, operationCount: 2 }] : [] });
    }
    if (url === '/api/simulations/preview') {
      const preview = previews[previewIndex++];
      const isError = typeof preview === 'object' && preview !== null && 'error' in preview;
      return response(preview, isError ? 400 : 200);
    }
    if (url === '/api/scenarios' && method === 'POST') return response(scenario, 201);
    if (url === '/api/scenarios/SCN-001') return response(scenario);
    throw new Error(`未模拟的请求：${method} ${url}`);
  });
}

function addTrade(side: 'buy' | 'sell', symbol: string, quantity: number): void {
  fireEvent.change(screen.getByTestId('trade-side'), { target: { value: side } });
  fireEvent.change(screen.getByTestId('trade-symbol'), { target: { value: symbol } });
  fireEvent.change(screen.getByTestId('trade-quantity'), { target: { value: String(quantity) } });
  fireEvent.click(screen.getByRole('button', { name: '加入操作' }));
}

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockReset();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('portfolio interaction flow', () => {
  it('loads the overview, adds ordered trades and shows the simulation comparison', async () => {
    setupApi();
    render(<App />);

    expect(await screen.findByRole('heading', { name: '投资组合分析' })).toBeInTheDocument();
    expect(screen.getByText('2 项超限')).toBeInTheDocument();

    addTrade('sell', 'A01', 100);
    addTrade('buy', 'A02', 100);
    expect(screen.getByText('2 笔')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '提交模拟' }));
    expect(await screen.findByText(/总资产守恒：100000\.00 → 100000\.00/)).toBeInTheDocument();
    expect(screen.getByText('行业集中度对比')).toBeInTheDocument();
    expect(screen.getByText('持仓明细对比')).toBeInTheDocument();
    const holdingsComparison = screen.getByRole('table', { name: '模拟持仓明细对比' });
    expect(within(holdingsComparison).getByRole('columnheader', { name: '模拟占比' })).toBeInTheDocument();
    expect(within(holdingsComparison).getByRole('columnheader', { name: '占比变化' })).toBeInTheDocument();
    expect(within(holdingsComparison).getByRole('columnheader', { name: '模拟状态' })).toBeInTheDocument();
    expect(within(holdingsComparison).getByText('-10.00%')).toBeInTheDocument();
    expect(within(holdingsComparison).getByText('25.00%')).toBeInTheDocument();
    expect(screen.getByText('55.00%')).toBeInTheDocument();
  });

  it('keeps the last successful result when a later operation fails', async () => {
    setupApi([simulation, {
      error: {
        code: 'INSUFFICIENT_HOLDING',
        message: '卖出数量超过当前持仓，当前持仓为 300',
        details: { operationIndex: 1 },
      },
    }]);
    render(<App />);

    await screen.findByRole('heading', { name: '投资组合分析' });
    addTrade('sell', 'A01', 100);
    fireEvent.click(screen.getByRole('button', { name: '提交模拟' }));
    await screen.findByText(/总资产守恒：100000\.00 → 100000\.00/);

    addTrade('sell', 'A01', 301);
    fireEvent.click(screen.getByRole('button', { name: '提交模拟' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('持仓不足');
    expect(alert).toHaveTextContent('第 2 笔操作失败');
    expect(screen.getByText(/上一次成功模拟结果/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '保存方案' })).toBeDisabled();
  });

  it('saves and reopens a scenario through the visible page controls', async () => {
    setupApi();
    render(<App />);

    await screen.findByRole('heading', { name: '投资组合分析' });
    addTrade('sell', 'A01', 100);
    addTrade('buy', 'A02', 100);
    fireEvent.click(screen.getByRole('button', { name: '提交模拟' }));
    await screen.findByText(/总资产守恒：100000\.00 → 100000\.00/);

    fireEvent.change(screen.getByRole('textbox', { name: '方案名称' }), { target: { value: scenario.name } });
    fireEvent.click(screen.getByRole('button', { name: '保存方案' }));
    expect(await screen.findByText(`方案“${scenario.name}”已保存`)).toBeInTheDocument();
    expect(await screen.findByText(scenario.name)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '重新打开' }));
    expect(await screen.findByText(`已重新打开方案“${scenario.name}”`)).toBeInTheDocument();
    await waitFor(() => expect(screen.getAllByText('2 笔').length).toBeGreaterThan(0));
  });
});
