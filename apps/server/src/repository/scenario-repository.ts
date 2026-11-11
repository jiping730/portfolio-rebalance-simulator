import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { SavedScenario, ScenarioStore, TradeOperation } from '../domain/types.js';

const DEFAULT_SCENARIO_PATH = fileURLToPath(new URL('../../data/scenarios.json', import.meta.url));

export class ScenarioRepositoryError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = 'ScenarioRepositoryError';
  }
}

export interface NewScenario {
  name: string;
  portfolioId: string;
  snapshotId: string;
  operations: TradeOperation[];
}

export class ScenarioRepository {
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(private readonly filePath = DEFAULT_SCENARIO_PATH) {}

  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    const run = this.writeQueue.then(task);
    this.writeQueue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  private async readStore(): Promise<ScenarioStore> {
    let content: string;
    try {
      content = await readFile(this.filePath, 'utf8');
    } catch (error) {
      if (isNodeError(error) && error.code === 'ENOENT') {
        return [];
      }
      throw new ScenarioRepositoryError('无法读取方案存储文件', error);
    }

    try {
      const parsed: unknown = JSON.parse(content);
      if (!Array.isArray(parsed)) {
        throw new Error('方案存储根节点必须是数组');
      }
      return parsed as ScenarioStore;
    } catch (error) {
      throw new ScenarioRepositoryError('方案存储文件不是合法的方案数组', error);
    }
  }

  private async writeStore(scenarios: ScenarioStore): Promise<void> {
    try {
      await mkdir(dirname(this.filePath), { recursive: true });
      await writeFile(this.filePath, `${JSON.stringify(scenarios, null, 2)}\n`, 'utf8');
    } catch (error) {
      throw new ScenarioRepositoryError('无法写入方案存储文件', error);
    }
  }

  async list(): Promise<ScenarioStore> {
    return this.enqueue(() => this.readStore());
  }

  async findById(scenarioId: string): Promise<SavedScenario | undefined> {
    return this.enqueue(async () => {
      const scenarios = await this.readStore();
      return scenarios.find((scenario) => scenario.scenarioId === scenarioId);
    });
  }

  async create(input: NewScenario): Promise<SavedScenario> {
    return this.enqueue(async () => {
      const scenario: SavedScenario = {
        ...input,
        scenarioId: `SCN-${randomUUID()}`,
        createdAt: new Date().toISOString(),
      };
      const scenarios = await this.readStore();
      scenarios.push(scenario);
      await this.writeStore(scenarios);
      return scenario;
    });
  }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}
