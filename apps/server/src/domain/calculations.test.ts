import { describe, expect, it } from 'vitest';
import { calculatePortfolio } from './calculations.js';
import { loadPortfolioSnapshot } from './snapshot.js';

describe('portfolio calculations and concentration alerts', () => {
  it('calculates the initial portfolio totals and alerts', () => {
    const result = calculatePortfolio(loadPortfolioSnapshot());
    const a01 = result.instruments.find((instrument) => instrument.symbol === 'A01');
    const technology = result.industries.find((industry) => industry.industry === '科技');

    expect(result.summary.totalAsset).toBe('100000.00');
    expect(result.summary.cash).toBe('20000.00');
    expect(result.summary.holdingCount).toBe(6);
    expect(a01).toMatchObject({ marketValue: '40000.00', ratioPercent: '40.00', isOverThreshold: true });
    expect(technology).toMatchObject({ marketValue: '60000.00', ratioPercent: '60.00', isOverThreshold: true });
    expect(result.summary.alerts.map((alert) => `${alert.type}:${alert.key}`)).toEqual([
      'instrument:A01',
      'industry:科技',
    ]);
  });

  it('does not alert at exactly 30 percent and 50 percent', () => {
    const snapshot = loadPortfolioSnapshot();
    snapshot.cash = '30000.00';
    snapshot.instruments.find((instrument) => instrument.symbol === 'A01')!.quantity = 300;

    const result = calculatePortfolio(snapshot);
    const a01 = result.instruments.find((instrument) => instrument.symbol === 'A01');
    const technology = result.industries.find((industry) => industry.industry === '科技');

    expect(a01).toMatchObject({ ratioPercent: '30.00', isOverThreshold: false });
    expect(technology).toMatchObject({ ratioPercent: '50.00', isOverThreshold: false });
    expect(result.summary.alerts).toEqual([]);
  });

  it('reports the AC-03 technology concentration after sequential-state values', () => {
    const snapshot = loadPortfolioSnapshot();
    snapshot.cash = '25000.00';
    snapshot.instruments.find((instrument) => instrument.symbol === 'A01')!.quantity = 300;
    snapshot.instruments.find((instrument) => instrument.symbol === 'A02')!.quantity = 500;

    const result = calculatePortfolio(snapshot);
    const a02 = result.instruments.find((instrument) => instrument.symbol === 'A02');
    const technology = result.industries.find((industry) => industry.industry === '科技');

    expect(result.summary.totalAsset).toBe('100000.00');
    expect(a02).toMatchObject({ marketValue: '25000.00', ratioPercent: '25.00' });
    expect(technology).toMatchObject({ marketValue: '55000.00', ratioPercent: '55.00', isOverThreshold: true });
  });
});
