import { describe, expect, it } from 'vitest';
import { loadPortfolioSnapshot } from './snapshot.js';
import { RebalanceSimulationError, simulateRebalance } from './simulation.js';

function expectSimulationError(
  operations: readonly unknown[],
  code: string,
  operationIndex?: number,
): void {
  try {
    simulateRebalance(loadPortfolioSnapshot(), operations);
    throw new Error('expected simulation to fail');
  } catch (error) {
    expect(error).toBeInstanceOf(RebalanceSimulationError);
    const simulationError = error as RebalanceSimulationError;
    expect(simulationError.code).toBe(code);
    if (operationIndex !== undefined) {
      expect(simulationError.operationIndex).toBe(operationIndex);
    }
  }
}

describe('atomic rebalance simulation', () => {
  it('executes sequential buy and sell operations and preserves total assets', () => {
    const snapshot = loadPortfolioSnapshot();
    const result = simulateRebalance(snapshot, [
      { side: 'sell', symbol: 'A01', quantity: 100 },
      { side: 'buy', symbol: 'A02', quantity: 100 },
    ]);

    expect(result.operations).toEqual([
      { order: 1, side: 'sell', symbol: 'A01', quantity: 100 },
      { order: 2, side: 'buy', symbol: 'A02', quantity: 100 },
    ]);
    expect(result.simulated.summary.cash).toBe('25000.00');
    expect(result.simulated.instruments.find((instrument) => instrument.symbol === 'A01')?.quantity).toBe(300);
    expect(result.simulated.instruments.find((instrument) => instrument.symbol === 'A02')).toMatchObject({
      quantity: 500,
      marketValue: '25000.00',
    });
    expect(result.simulated.industries.find((industry) => industry.industry === '科技')).toMatchObject({
      ratioPercent: '55.00',
      isOverThreshold: true,
    });
    expect(result.invariant).toEqual({
      originalTotalAsset: '100000.00',
      simulatedTotalAsset: '100000.00',
      isPreserved: true,
    });
    expect(snapshot.cash).toBe('20000.00');
    expect(snapshot.instruments.find((instrument) => instrument.symbol === 'A01')?.quantity).toBe(400);
  });

  it('rejects insufficient cash and overselling', () => {
    expectSimulationError([{ side: 'buy', symbol: 'A01', quantity: 201 }], 'INSUFFICIENT_CASH', 0);
    expectSimulationError([{ side: 'sell', symbol: 'A01', quantity: 401 }], 'INSUFFICIENT_HOLDING', 0);
  });

  it('rejects zero, negative, fractional and unknown operations', () => {
    expectSimulationError([{ side: 'buy', symbol: 'A01', quantity: 0 }], 'INVALID_QUANTITY', 0);
    expectSimulationError([{ side: 'buy', symbol: 'A01', quantity: -1 }], 'INVALID_QUANTITY', 0);
    expectSimulationError([{ side: 'buy', symbol: 'A01', quantity: 1.5 }], 'INVALID_QUANTITY', 0);
    expectSimulationError([{ side: 'buy', symbol: 'UNKNOWN', quantity: 1 }], 'UNKNOWN_SYMBOL', 0);
    expectSimulationError([{ side: 'hold', symbol: 'A01', quantity: 1 }], 'INVALID_SIDE', 0);
  });

  it('discards all prior temporary changes when a later operation fails', () => {
    const snapshot = loadPortfolioSnapshot();
    expectSimulationError(
      [
        { side: 'sell', symbol: 'A01', quantity: 100 },
        { side: 'sell', symbol: 'A01', quantity: 301 },
      ],
      'INSUFFICIENT_HOLDING',
      1,
    );
    expect(snapshot.cash).toBe('20000.00');
    expect(snapshot.instruments.find((instrument) => instrument.symbol === 'A01')?.quantity).toBe(400);
  });

  it('rejects empty operation lists', () => {
    expectSimulationError([], 'EMPTY_OPERATIONS');
  });
});
