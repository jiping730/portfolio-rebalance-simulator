export type MoneyString = string;
export type PercentageString = string;
export type RatioString = string;
export type Currency = 'CNY';
export type ComparisonRule = 'strictly_greater_than';
export type QuantityRule = 'positive_integer';
export type TradeSide = 'buy' | 'sell';

export interface RawPortfolioRules {
  single_instrument_threshold: RatioString;
  industry_threshold: RatioString;
  comparison: ComparisonRule;
  cash_in_denominator: boolean;
  cash_in_industry: boolean;
  quantity: QuantityRule;
  fees: MoneyString;
}

export interface RawPortfolioInstrument {
  symbol: string;
  name: string;
  industry: string;
  price: MoneyString;
  quantity: number;
}

export interface RawPortfolioSnapshot {
  portfolio_id: string;
  name: string;
  currency: Currency;
  snapshot_id: string;
  snapshot_at: string;
  cash: MoneyString;
  instruments: RawPortfolioInstrument[];
  rules: RawPortfolioRules;
}

export interface PortfolioRules {
  singleInstrumentThreshold: number;
  industryThreshold: number;
  comparison: ComparisonRule;
  cashInDenominator: boolean;
  cashInIndustry: boolean;
  quantity: QuantityRule;
  fees: MoneyString;
}

export interface Instrument {
  symbol: string;
  name: string;
  industry: string;
  price: MoneyString;
  quantity: number;
}

export interface PortfolioSnapshot {
  portfolioId: string;
  snapshotId: string;
  name: string;
  currency: Currency;
  snapshotAt: string;
  cash: MoneyString;
  instruments: Instrument[];
  rules: PortfolioRules;
}

export type ConcentrationAlertType = 'instrument' | 'industry';

export interface ConcentrationAlert {
  type: ConcentrationAlertType;
  key: string;
  label: string;
  ratioPercent: PercentageString;
  thresholdPercent: PercentageString;
}

export interface InstrumentAnalysis extends Instrument {
  marketValue: MoneyString;
  ratioPercent: PercentageString;
  isOverThreshold: boolean;
  thresholdPercent: PercentageString;
}

export interface IndustryAnalysis {
  industry: string;
  marketValue: MoneyString;
  ratioPercent: PercentageString;
  isOverThreshold: boolean;
  thresholdPercent: PercentageString;
}

export interface PortfolioSummary {
  totalAsset: MoneyString;
  cash: MoneyString;
  holdingCount: number;
  alerts: ConcentrationAlert[];
}

export interface PortfolioAnalysis {
  summary: PortfolioSummary;
  instruments: InstrumentAnalysis[];
  industries: IndustryAnalysis[];
}

export interface SimulationInvariant {
  originalTotalAsset: MoneyString;
  simulatedTotalAsset: MoneyString;
  isPreserved: boolean;
}

export interface RebalanceSimulationResult {
  operations: TradeOperation[];
  original: PortfolioAnalysis;
  simulated: PortfolioAnalysis;
  invariant: SimulationInvariant;
}

export interface TradeOperationInput {
  side: TradeSide;
  symbol: string;
  quantity: number;
}

export interface TradeOperation extends TradeOperationInput {
  order: number;
}

export interface SavedScenario {
  scenarioId: string;
  name: string;
  portfolioId: string;
  snapshotId: string;
  operations: TradeOperation[];
  createdAt: string;
}

export type ScenarioStore = SavedScenario[];
