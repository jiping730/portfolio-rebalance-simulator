import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ScenarioRepository } from './scenario-repository.js';

let scenarioDirectory: string;
let scenarioFile: string;

beforeAll(async () => {
  scenarioDirectory = await mkdtemp(join(tmpdir(), 'portfolio-repository-'));
  scenarioFile = join(scenarioDirectory, 'scenarios.json');
});

afterAll(async () => {
  await writeFile(scenarioFile, '[]\n', 'utf8');
  await rm(scenarioDirectory, { recursive: true, force: true });
});

describe('ScenarioRepository persistence', () => {
  it('reads a saved scenario with a new repository instance', async () => {
    const writer = new ScenarioRepository(scenarioFile);
    const saved = await writer.create({
      name: '重启读取测试',
      portfolioId: 'DEMO-001',
      snapshotId: 'SNAP-20261102',
      operations: [{ order: 1, side: 'sell', symbol: 'A01', quantity: 100 }],
    });

    const reader = new ScenarioRepository(scenarioFile);

    await expect(reader.list()).resolves.toEqual([saved]);
    await expect(reader.findById(saved.scenarioId)).resolves.toEqual(saved);
  });
});
