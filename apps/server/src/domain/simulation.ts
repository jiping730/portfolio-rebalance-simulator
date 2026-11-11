import { calculatePortfolio } from './calculations.js';
import { formatCents, parseMoneyToCents } from './money.js';
import type {
  PortfolioSnapshot,
  RebalanceSimulationResult,
  TradeOperation,
  TradeSide,
} from './types.js';

export type RebalanceErrorCode =
  | 'EMPTY_OPERATIONS'
  | 'INVALID_OPERATION'
  | 'INVALID_SIDE'
  | 'INVALID_QUANTITY'
  | 'UNKNOWN_SYMBOL'
  | 'INSUFFICIENT_CASH'
  | 'INSUFFICIENT_HOLDING'
  | 'AMOUNT_OVERFLOW'
  | 'TOTAL_ASSET_NOT_PRESERVED';

export class RebalanceSimulationError extends Error {
  constructor(
    public readonly code: RebalanceErrorCode,
    message: string,
    public readonly operationIndex?: number,
  ) {
    super(message);
    this.name = 'RebalanceSimulationError';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isTradeSide(value: unknown): value is TradeSide {
  return value === 'buy' || value === 'sell';
}

function assertSafeAmount(value: number, operationIndex: number): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RebalanceSimulationError('AMOUNT_OVERFLOW', '交易金额超出安全整数范围', operationIndex);
  }
}

function multiplyPriceAndQuantity(priceCents: number, quantity: number, operationIndex: number): number {
  const cost = priceCents * quantity;
  assertSafeAmount(cost, operationIndex);
  return cost;
}

function normalizeOperation(value: unknown, operationIndex: number): TradeOperation {
  if (!isRecord(value)) {
    throw new RebalanceSimulationError('INVALID_OPERATION', '交易操作必须为对象', operationIndex);
  }
  if (!isTradeSide(value.side)) {
    throw new RebalanceSimulationError('INVALID_SIDE', '交易方向必须为 buy 或 sell', operationIndex);
  }
  if (typeof value.symbol !== 'string' || value.symbol.trim().length === 0) {
    throw new RebalanceSimulationError('INVALID_OPERATION', '交易标的不能为空', operationIndex);
  }
  if (typeof value.quantity !== 'number' || !Number.isSafeInteger(value.quantity) || value.quantity <= 0) {
    throw new RebalanceSimulationError('INVALID_QUANTITY', '交易数量必须为正整数', operationIndex);
  }

  return {
    order: operationIndex + 1,
    side: value.side,
    symbol: value.symbol,
    quantity: value.quantity,
  };
}

function createSimulatedSnapshot(
  snapshot: PortfolioSnapshot,
  cashCents: number,
  holdings: Map<string, number>,
): PortfolioSnapshot {
  return {
    ...snapshot,
    cash: formatCents(cashCents),
    instruments: snapshot.instruments.map((instrument) => ({
      ...instrument,
      quantity: holdings.get(instrument.symbol) ?? 0,
    })),
  };
}

export function simulateRebalance(
  snapshot: PortfolioSnapshot,
  operations: readonly unknown[],
): RebalanceSimulationResult {
  if (operations.length === 0) {
    throw new RebalanceSimulationError('EMPTY_OPERATIONS', '至少需要一笔交易操作');
  }

  const original = calculatePortfolio(snapshot);
  let cashCents = parseMoneyToCents(snapshot.cash);
  const holdings = new Map(snapshot.instruments.map((instrument) => [instrument.symbol, instrument.quantity]));
  const prices = new Map(
    snapshot.instruments.map((instrument) => [instrument.symbol, parseMoneyToCents(instrument.price)]),
  );
  const normalizedOperations: TradeOperation[] = [];

  operations.forEach((value, operationIndex) => {
    const operation = normalizeOperation(value, operationIndex);
    const currentHolding = holdings.get(operation.symbol);
    const priceCents = prices.get(operation.symbol);
    if (currentHolding === undefined || priceCents === undefined) {
      throw new RebalanceSimulationError(
        'UNKNOWN_SYMBOL',
        `交易标的不存在：${operation.symbol}`,
        operationIndex,
      );
    }

    const costCents = multiplyPriceAndQuantity(priceCents, operation.quantity, operationIndex);
    if (operation.side === 'buy') {
      if (costCents > cashCents) {
        throw new RebalanceSimulationError(
          'INSUFFICIENT_CASH',
          `买入后现金不足，需要 ${formatCents(costCents)}，当前现金为 ${formatCents(cashCents)}`,
          operationIndex,
        );
      }
      const nextHolding = currentHolding + operation.quantity;
      assertSafeAmount(nextHolding, operationIndex);
      cashCents -= costCents;
      holdings.set(operation.symbol, nextHolding);
    } else {
      if (operation.quantity > currentHolding) {
        throw new RebalanceSimulationError(
          'INSUFFICIENT_HOLDING',
          `卖出数量超过当前持仓，当前持仓为 ${currentHolding}`,
          operationIndex,
        );
      }
      const nextCash = cashCents + costCents;
      assertSafeAmount(nextCash, operationIndex);
      cashCents = nextCash;
      holdings.set(operation.symbol, currentHolding - operation.quantity);
    }
    normalizedOperations.push(operation);
  });

  const simulated = calculatePortfolio(createSimulatedSnapshot(snapshot, cashCents, holdings));
  const invariant = {
    originalTotalAsset: original.summary.totalAsset,
    simulatedTotalAsset: simulated.summary.totalAsset,
    isPreserved: original.summary.totalAsset === simulated.summary.totalAsset,
  };
  if (!invariant.isPreserved) {
    throw new RebalanceSimulationError('TOTAL_ASSET_NOT_PRESERVED', '模拟前后总资产未保持一致');
  }

  return {
    operations: normalizedOperations,
    original,
    simulated,
    invariant,
  };
}
