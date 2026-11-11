import { createServer, type Server } from 'node:http';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { createApp } from './app.js';
import { loadPortfolioSnapshot } from '../domain/snapshot.js';
import { ScenarioRepository } from '../repository/scenario-repository.js';

let server: Server;
let baseUrl: string;
let scenarioDirectory: string;

async function request(path: string, init?: RequestInit): Promise<{ status: number; body: any }> {
  const response = await fetch(`${baseUrl}${path}`, init);
  return { status: response.status, body: await response.json() };
}

beforeAll(async () => {
  scenarioDirectory = await mkdtemp(join(tmpdir(), 'portfolio-scenarios-'));
  const repository = new ScenarioRepository(join(scenarioDirectory, 'scenarios.json'));
  server = createServer(createApp({ snapshot: loadPortfolioSnapshot(), repository }));
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('test server did not bind to a TCP port');
  }
  baseUrl = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  await rm(scenarioDirectory, { recursive: true, force: true });
});

describe('portfolio and scenario APIs', () => {
  it('returns the portfolio overview and concentration alerts', async () => {
    const result = await request('/api/portfolio');

    expect(result.status).toBe(200);
    expect(result.body.portfolio.snapshotId).toBe('SNAP-20261102');
    expect(result.body.summary.totalAsset).toBe('100000.00');
    expect(result.body.summary.alerts.map((alert: { key: string }) => alert.key)).toEqual(['A01', '科技']);
  });

  it('previews sequential operations and returns the invariant', async () => {
    const result = await request('/api/simulations/preview', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        operations: [
          { side: 'sell', symbol: 'A01', quantity: 100 },
          { side: 'buy', symbol: 'A02', quantity: 100 },
        ],
      }),
    });

    expect(result.status).toBe(200);
    expect(result.body.simulated.summary.cash).toBe('25000.00');
    expect(result.body.invariant.isPreserved).toBe(true);
  });

  it('returns the unified error shape for invalid operations and JSON', async () => {
    const invalidOperation = await request('/api/simulations/preview', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ operations: [{ side: 'buy', symbol: 'A01', quantity: 201 }] }),
    });
    expect(invalidOperation.status).toBe(400);
    expect(invalidOperation.body.error).toMatchObject({ code: 'INSUFFICIENT_CASH' });
    expect(invalidOperation.body.error.details).toEqual({ operationIndex: 0 });

    const invalidJson = await request('/api/simulations/preview', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{',
    });
    expect(invalidJson.status).toBe(400);
    expect(invalidJson.body.error.code).toBe('INVALID_JSON');
  });

  it('saves, lists and reopens a scenario from the JSON repository', async () => {
    const saved = await request('/api/scenarios', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: '降低科技集中度',
        operations: [{ side: 'sell', symbol: 'A01', quantity: 100 }],
      }),
    });
    expect(saved.status).toBe(201);
    expect(saved.body.scenarioId).toMatch(/^SCN-/);
    expect(saved.body.result.invariant.isPreserved).toBe(true);

    const listed = await request('/api/scenarios');
    expect(listed.status).toBe(200);
    expect(listed.body.data).toHaveLength(1);
    expect(listed.body.data[0].operationCount).toBe(1);

    const reopened = await request(`/api/scenarios/${saved.body.scenarioId}`);
    expect(reopened.status).toBe(200);
    expect(reopened.body.result.summary.cash).toBe('30000.00');

    const persisted = JSON.parse(await readFile(join(scenarioDirectory, 'scenarios.json'), 'utf8')) as unknown[];
    expect(persisted).toHaveLength(1);
  });

  it('returns 404 for an unknown scenario', async () => {
    const result = await request('/api/scenarios/SCN-missing');
    expect(result.status).toBe(404);
    expect(result.body.error.code).toBe('SCENARIO_NOT_FOUND');
  });
});
