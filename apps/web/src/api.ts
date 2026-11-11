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

export interface PortfolioOverview {
  portfolio: {
    portfolioId: string;
    snapshotId: string;
    name: string;
    currency: string;
    snapshotAt: string;
    cash: string;
  };
  summary: {
    totalAsset: string;
    cash: string;
    holdingCount: number;
    alerts: ConcentrationAlert[];
  };
  instruments: InstrumentAnalysis[];
  industries: IndustryAnalysis[];
}

export class PortfolioApiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PortfolioApiError';
  }
}

export async function fetchPortfolio(signal?: AbortSignal): Promise<PortfolioOverview> {
  const response = await fetch('/api/portfolio', { signal });
  const payload = (await response.json().catch(() => null)) as
    | { error?: { message?: string } }
    | PortfolioOverview
    | null;

  if (!response.ok) {
    const message = payload && 'error' in payload && payload.error?.message;
    throw new PortfolioApiError(message || '组合数据加载失败，请稍后重试');
  }

  return payload as PortfolioOverview;
}
