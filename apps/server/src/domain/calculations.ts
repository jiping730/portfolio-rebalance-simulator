import type {
  IndustryAnalysis,
  InstrumentAnalysis,
  PortfolioAnalysis,
  PortfolioSnapshot,
  ConcentrationAlert,
} from './types.js';
import {
  formatCents,
  formatPercentFromCents,
  formatRatioPercent,
  isRatioOverThreshold,
  parseMoneyToCents,
} from './money.js';

export class PortfolioCalculationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PortfolioCalculationError';
  }
}

function addCents(left: number, right: number): number {
  const result = left + right;
  if (!Number.isSafeInteger(result) || result < 0) {
    throw new PortfolioCalculationError('金额计算结果超出安全整数范围');
  }
  return result;
}

function multiplyCents(cents: number, quantity: number): number {
  const result = cents * quantity;
  if (!Number.isSafeInteger(result) || result < 0) {
    throw new PortfolioCalculationError('市值计算结果超出安全整数范围');
  }
  return result;
}

export function calculatePortfolio(snapshot: PortfolioSnapshot): PortfolioAnalysis {
  const cashCents = parseMoneyToCents(snapshot.cash);
  const industryMarketValues = new Map<string, number>();
  let totalHoldingMarketValueCents = 0;

  const instruments: InstrumentAnalysis[] = snapshot.instruments.map((instrument) => {
    const priceCents = parseMoneyToCents(instrument.price);
    const marketValueCents = multiplyCents(priceCents, instrument.quantity);
    totalHoldingMarketValueCents = addCents(totalHoldingMarketValueCents, marketValueCents);
    industryMarketValues.set(
      instrument.industry,
      addCents(industryMarketValues.get(instrument.industry) ?? 0, marketValueCents),
    );

    return {
      ...instrument,
      marketValue: formatCents(marketValueCents),
      ratioPercent: '',
      isOverThreshold: false,
      thresholdPercent: formatRatioPercent(snapshot.rules.singleInstrumentThreshold),
    };
  });

  const totalAssetCents = snapshot.rules.cashInDenominator
    ? addCents(totalHoldingMarketValueCents, cashCents)
    : totalHoldingMarketValueCents;
  if (totalAssetCents === 0) {
    throw new PortfolioCalculationError('组合总资产不能为零');
  }

  const alerts: ConcentrationAlert[] = [];
  for (const instrument of instruments) {
    const marketValueCents = parseMoneyToCents(instrument.marketValue);
    instrument.ratioPercent = formatPercentFromCents(marketValueCents, totalAssetCents);
    instrument.isOverThreshold = isRatioOverThreshold(
      marketValueCents,
      totalAssetCents,
      snapshot.rules.singleInstrumentThreshold,
    );
    if (instrument.isOverThreshold) {
      alerts.push({
        type: 'instrument',
        key: instrument.symbol,
        label: instrument.name,
        ratioPercent: instrument.ratioPercent,
        thresholdPercent: instrument.thresholdPercent,
      });
    }
  }

  const industries: IndustryAnalysis[] = Array.from(industryMarketValues.entries()).map(
    ([industry, marketValueCents]) => {
      const ratioPercent = formatPercentFromCents(marketValueCents, totalAssetCents);
      const isOverThreshold = isRatioOverThreshold(
        marketValueCents,
        totalAssetCents,
        snapshot.rules.industryThreshold,
      );
      const thresholdPercent = formatRatioPercent(snapshot.rules.industryThreshold);
      if (isOverThreshold) {
        alerts.push({
          type: 'industry',
          key: industry,
          label: `${industry}行业`,
          ratioPercent,
          thresholdPercent,
        });
      }
      return {
        industry,
        marketValue: formatCents(marketValueCents),
        ratioPercent,
        isOverThreshold,
        thresholdPercent,
      };
    },
  );

  return {
    summary: {
      totalAsset: formatCents(totalAssetCents),
      cash: formatCents(cashCents),
      holdingCount: snapshot.instruments.length,
      alerts,
    },
    instruments,
    industries,
  };
}
