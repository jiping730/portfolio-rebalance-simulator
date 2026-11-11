export interface ConcentrationAlert {
  type: 'instrument' | 'industry';
  key: string;
  label: string;
  ratioPercent: string;
  thresholdPercent: string;
}

export interface InstrumentAnalysis {
  symbol: string;
  name: string;
  industry: string;
  price: string;
  quantity: number;
  marketValue: string;
  ratioPercent: string;
  isOverThreshold: boolean;
  thresholdPercent: string;
}

export interface IndustryAnalysis {
  industry: string;
  marketValue: string;
  ratioPercent: string;
  isOverThreshold: boolean;
  thresholdPercent: string;
}

export interface PortfolioSummary {
  totalAsset: string;
  cash: string;
  holdingCount: number;
  alerts: ConcentrationAlert[];
}

export interface PortfolioAnalysis {
  summary: PortfolioSummary;
  instruments: InstrumentAnalysis[];
  industries: IndustryAnalysis[];
}

export interface PortfolioOverview extends PortfolioAnalysis {
  portfolio: {
    portfolioId: string;
    snapshotId: string;
    name: string;
    currency: string;
    snapshotAt: string;
    cash: string;
  };
}

export type TradeSide = 'buy' | 'sell';

export interface TradeOperationInput {
  side: TradeSide;
  symbol: string;
  quantity: number;
}

export interface TradeOperation extends TradeOperationInput {
  order: number;
}

export interface SimulationInvariant {
  originalTotalAsset: string;
  simulatedTotalAsset: string;
  isPreserved: boolean;
}

export interface SimulationResult {
  operations: TradeOperation[];
  original: PortfolioAnalysis;
  simulated: PortfolioAnalysis;
  invariant: SimulationInvariant;
}

export interface ScenarioListItem {
  scenarioId: string;
  name: string;
  portfolioId: string;
  snapshotId: string;
  operationCount: number;
  createdAt: string;
}

export interface ScenarioDetail {
  scenarioId: string;
  name: string;
  portfolioId: string;
  snapshotId: string;
  operations: TradeOperation[];
  createdAt: string;
  result: PortfolioAnalysis & { invariant: SimulationInvariant };
}

export class PortfolioApiError extends Error {
  constructor(
    message: string,
    public readonly code?: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'PortfolioApiError';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function requestJson<T>(input: RequestInfo | URL, init?: RequestInit): Promise<T> {
  const response = await fetch(input, init);
  const payload = (await response.json().catch(() => null)) as unknown;

  if (!response.ok) {
    const error = isRecord(payload) && isRecord(payload.error) ? payload.error : undefined;
    const message = error && typeof error.message === 'string' ? error.message : '请求失败，请稍后重试';
    const code = error && typeof error.code === 'string' ? error.code : undefined;
    const details = error && isRecord(error.details) ? error.details : undefined;
    throw new PortfolioApiError(message, code, details);
  }

  return payload as T;
}

export function fetchPortfolio(signal?: AbortSignal): Promise<PortfolioOverview> {
  return requestJson<PortfolioOverview>('/api/portfolio', { signal });
}

export function previewSimulation(operations: TradeOperationInput[]): Promise<SimulationResult> {
  return requestJson<SimulationResult>('/api/simulations/preview', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ operations }),
  });
}

export function saveScenario(name: string, operations: TradeOperationInput[]): Promise<ScenarioDetail> {
  return requestJson<ScenarioDetail>('/api/scenarios', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name, operations }),
  });
}

export async function fetchScenarios(): Promise<ScenarioListItem[]> {
  const payload = await requestJson<{ data: ScenarioListItem[] }>('/api/scenarios');
  return payload.data;
}

export function fetchScenario(scenarioId: string): Promise<ScenarioDetail> {
  return requestJson<ScenarioDetail>(`/api/scenarios/${encodeURIComponent(scenarioId)}`);
}
