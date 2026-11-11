import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  loadPortfolioSnapshot,
  parsePortfolioSnapshotJson,
  SnapshotValidationError,
  validateRawPortfolioSnapshot,
} from './snapshot.js';

const fixturePath = fileURLToPath(new URL('../../data/portfolio.json', import.meta.url));
const validRaw = JSON.parse(readFileSync(fixturePath, 'utf8')) as Record<string, unknown>;

function copyFixture(): Record<string, unknown> {
  return structuredClone(validRaw);
}

function expectIssue(mutator: (input: Record<string, unknown>) => void, code: string): void {
  const input = copyFixture();
  mutator(input);
  try {
    validateRawPortfolioSnapshot(input);
    throw new Error('expected snapshot validation to fail');
  } catch (error) {
    expect(error).toBeInstanceOf(SnapshotValidationError);
    expect((error as SnapshotValidationError).issues.some((issue) => issue.code === code)).toBe(true);
  }
}

describe('portfolio snapshot loader', () => {
  it('loads and normalizes the provided snapshot', () => {
    const snapshot = loadPortfolioSnapshot();

    expect(snapshot.portfolioId).toBe('DEMO-001');
    expect(snapshot.snapshotId).toBe('SNAP-20261102');
    expect(snapshot.instruments).toHaveLength(6);
    expect(snapshot.rules.singleInstrumentThreshold).toBe(0.3);
    expect(snapshot.rules.cashInDenominator).toBe(true);
  });

  it('rejects malformed JSON', () => {
    expect(() => parsePortfolioSnapshotJson('{')).toThrow(SnapshotValidationError);
  });

  it('rejects missing identifiers and empty industries', () => {
    expectIssue((input) => {
      input.snapshot_id = '';
      (input.instruments as Array<Record<string, unknown>>)[0].industry = '  ';
    }, 'REQUIRED_FIELD');
  });

  it('rejects invalid money and quantities', () => {
    expectIssue((input) => {
      (input.instruments as Array<Record<string, unknown>>)[0].price = '-1.00';
      (input.instruments as Array<Record<string, unknown>>)[1].quantity = 1.5;
    }, 'INVALID_MONEY');
    expectIssue((input) => {
      (input.instruments as Array<Record<string, unknown>>)[1].quantity = 1.5;
    }, 'INVALID_QUANTITY');
  });

  it('rejects invalid rule settings and duplicate symbols', () => {
    expectIssue((input) => {
      (input.rules as Record<string, unknown>).cash_in_industry = true;
    }, 'INVALID_RULE');
    expectIssue((input) => {
      (input.instruments as Array<Record<string, unknown>>)[1].symbol = 'A01';
    }, 'DUPLICATE_SYMBOL');
  });
});
