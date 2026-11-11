import { describe, expect, it } from 'vitest';
import {
  formatCents,
  formatPercentFromCents,
  formatRatioPercent,
  isRatioOverThreshold,
  parseMoneyToCents,
} from './money.js';

describe('integer-cent money and ratio helpers', () => {
  it('parses and formats money without floating-point amounts', () => {
    expect(parseMoneyToCents('20000.00')).toBe(2_000_000);
    expect(formatCents(4_000_000)).toBe('40000.00');
  });

  it('formats percentages to two decimal places', () => {
    expect(formatPercentFromCents(30_000, 100_000)).toBe('30.00');
    expect(formatRatioPercent('0.50')).toBe('50.00');
  });

  it('uses strict cross multiplication at threshold boundaries', () => {
    expect(isRatioOverThreshold(30_000, 100_000, '0.30')).toBe(false);
    expect(isRatioOverThreshold(30_001, 100_000, '0.30')).toBe(true);
  });

  it('rejects malformed money values', () => {
    expect(() => parseMoneyToCents('-1.00')).toThrow();
    expect(() => parseMoneyToCents('1.2')).toThrow();
  });
});
