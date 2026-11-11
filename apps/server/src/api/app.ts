import express, { type ErrorRequestHandler, type Request, type Response } from 'express';
import { calculatePortfolio } from '../domain/calculations.js';
import { RebalanceSimulationError, simulateRebalance } from '../domain/simulation.js';
import { loadPortfolioSnapshot } from '../domain/snapshot.js';
import type { PortfolioSnapshot, RebalanceSimulationResult } from '../domain/types.js';
import { ScenarioRepository, ScenarioRepositoryError } from '../repository/scenario-repository.js';

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export interface AppDependencies {
  snapshot?: PortfolioSnapshot;
  repository?: ScenarioRepository;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readOperations(body: unknown): readonly unknown[] {
  if (!isRecord(body) || !Array.isArray(body.operations)) {
    throw new ApiError(400, 'VALIDATION_ERROR', '请求必须包含 operations 数组');
  }
  return body.operations;
}

function readScenarioName(body: unknown): string {
  if (!isRecord(body) || typeof body.name !== 'string') {
    throw new ApiError(400, 'EMPTY_SCENARIO_NAME', '方案名不能为空');
  }
  const name = body.name.trim();
  if (name.length < 1 || name.length > 80) {
    throw new ApiError(400, 'EMPTY_SCENARIO_NAME', '方案名长度必须为 1-80 个字符');
  }
  return name;
}

function portfolioResponse(snapshot: PortfolioSnapshot) {
  return {
    portfolio: {
      portfolioId: snapshot.portfolioId,
      snapshotId: snapshot.snapshotId,
      name: snapshot.name,
      currency: snapshot.currency,
      snapshotAt: snapshot.snapshotAt,
      cash: snapshot.cash,
    },
    ...calculatePortfolio(snapshot),
  };
}

function scenarioResult(result: RebalanceSimulationResult) {
  return {
    ...result.simulated,
    invariant: result.invariant,
  };
}

function mapDomainError(error: unknown): ApiError | undefined {
  if (error instanceof RebalanceSimulationError) {
    const details = error.operationIndex === undefined ? undefined : { operationIndex: error.operationIndex };
    return new ApiError(400, error.code, error.message, details);
  }
  if (error instanceof ScenarioRepositoryError) {
    return new ApiError(500, 'STORAGE_ERROR', error.message);
  }
  return undefined;
}

const errorHandler: ErrorRequestHandler = (error, _request, response, _next) => {
  if (error instanceof ApiError) {
    response.status(error.status).json({
      error: {
        code: error.code,
        message: error.message,
        ...(error.details ? { details: error.details } : {}),
      },
    });
    return;
  }

  const mappedError = mapDomainError(error);
  if (mappedError) {
    errorHandler(mappedError, _request, response, _next);
    return;
  }

  if (isJsonSyntaxError(error)) {
    response.status(400).json({
      error: {
        code: 'INVALID_JSON',
        message: '请求体不是合法 JSON',
      },
    });
    return;
  }

  response.status(500).json({
    error: {
      code: 'INTERNAL_ERROR',
      message: '服务端发生未预期错误',
    },
  });
};

function isJsonSyntaxError(error: unknown): boolean {
  return error instanceof SyntaxError && isRecord(error) && 'body' in error;
}

export function createApp(dependencies: AppDependencies = {}) {
  const snapshot = dependencies.snapshot ?? loadPortfolioSnapshot();
  const repository = dependencies.repository ?? new ScenarioRepository();
  const app = express();

  app.use(express.json());

  app.get('/health', (_request, response) => {
    response.json({ status: 'ok' });
  });

  app.get('/api/portfolio', (_request, response) => {
    response.json(portfolioResponse(snapshot));
  });

  app.post('/api/simulations/preview', (request, response) => {
    const result = simulateRebalance(snapshot, readOperations(request.body));
    response.json(result);
  });

  app.post('/api/scenarios', async (request, response, next) => {
    try {
      const operations = readOperations(request.body);
      const name = readScenarioName(request.body);
      const result = simulateRebalance(snapshot, operations);
      const savedScenario = await repository.create({
        name,
        portfolioId: snapshot.portfolioId,
        snapshotId: snapshot.snapshotId,
        operations: result.operations,
      });
      response.status(201).json({ ...savedScenario, result: scenarioResult(result) });
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/scenarios', async (_request, response, next) => {
    try {
      const scenarios = await repository.list();
      response.json({
        data: scenarios.map((scenario) => ({
          scenarioId: scenario.scenarioId,
          name: scenario.name,
          portfolioId: scenario.portfolioId,
          snapshotId: scenario.snapshotId,
          operationCount: scenario.operations.length,
          createdAt: scenario.createdAt,
        })),
      });
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/scenarios/:scenarioId', async (request, response, next) => {
    try {
      const scenario = await repository.findById(request.params.scenarioId);
      if (!scenario) {
        throw new ApiError(404, 'SCENARIO_NOT_FOUND', '方案不存在或已被移除');
      }
      if (scenario.portfolioId !== snapshot.portfolioId || scenario.snapshotId !== snapshot.snapshotId) {
        throw new ApiError(500, 'INVALID_SNAPSHOT', '方案关联的组合快照不可用');
      }
      const result = simulateRebalance(snapshot, scenario.operations);
      response.json({ ...scenario, result: scenarioResult(result) });
    } catch (error) {
      next(error);
    }
  });

  app.use(errorHandler);
  return app;
}
