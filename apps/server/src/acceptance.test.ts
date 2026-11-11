import { createServer, type Server } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from './api/app.js';
import { loadPortfolioSnapshot } from './domain/snapshot.js';
import { ScenarioRepository } from './repository/scenario-repository.js';

let server: Server;
let baseUrl: string;
let scenarioDirectory: string;

async function request(path: string, init?: RequestInit): Promise<{ status: number; body: any }> {
  const response = await fetch(`${baseUrl}${path}`, init);
  return { status: response.status, body: await response.json() };
}

function postJson(path: string, body: unknown) {
  return request(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

beforeAll(async () => {
  scenarioDirectory = await mkdtemp(join(tmpdir(), 'portfolio-acceptance-'));
  server = createServer(createApp({
    snapshot: loadPortfolioSnapshot(),
    repository: new ScenarioRepository(join(scenarioDirectory, 'scenarios.json')),
  }));
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('acceptance server did not bind to a TCP port');
  }
  baseUrl = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  await rm(scenarioDirectory, { recursive: true, force: true });
});

describe('acceptance cases AC-01 to AC-05', () => {
  it('AC-01: shows the initial total, cash and concentration alerts', async () => {
    const result = await request('/api/portfolio');
    expect(result.status).toBe(200);
    expect(result.body.summary).toMatchObject({ totalAsset: '100000.00', cash: '20000.00' });
    expect(result.body.summary.alerts.map((alert: { key: string }) => alert.key)).toEqual(['A01', '科技']);
  });

  it('AC-02: removes both alerts at the exact 30% and 50% boundaries', async () => {
    const result = await postJson('/api/simulations/preview', {
      operations: [{ side: 'sell', symbol: 'A01', quantity: 100 }],
    });
    expect(result.status).toBe(200);
    expect(result.body.simulated.summary.cash).toBe('30000.00');
    expect(result.body.simulated.instruments.find((item: { symbol: string }) => item.symbol === 'A01')).toMatchObject({ ratioPercent: '30.00', isOverThreshold: false });
    expect(result.body.simulated.industries.find((item: { industry: string }) => item.industry === '科技')).toMatchObject({ ratioPercent: '50.00', isOverThreshold: false });
    expect(result.body.simulated.summary.alerts).toEqual([]);
  });

  it('AC-03: applies sequential operations and raises technology concentration again', async () => {
    const result = await postJson('/api/simulations/preview', {
      operations: [
        { side: 'sell', symbol: 'A01', quantity: 100 },
        { side: 'buy', symbol: 'A02', quantity: 100 },
      ],
    });
    expect(result.status).toBe(200);
    expect(result.body.simulated.summary).toMatchObject({ totalAsset: '100000.00', cash: '25000.00' });
    expect(result.body.simulated.instruments.find((item: { symbol: string }) => item.symbol === 'A02')).toMatchObject({ quantity: 500, marketValue: '25000.00' });
    expect(result.body.simulated.industries.find((item: { industry: string }) => item.industry === '科技')).toMatchObject({ ratioPercent: '55.00', isOverThreshold: true });
    expect(result.body.invariant.isPreserved).toBe(true);
  });

  it('AC-04: rejects every invalid operation without returning a partial simulation', async () => {
    const invalidOperations = [
      [{ side: 'buy', symbol: 'A01', quantity: 201 }],
      [{ side: 'sell', symbol: 'A01', quantity: 401 }],
      [{ side: 'buy', symbol: 'A01', quantity: 0 }],
      [{ side: 'buy', symbol: 'A01', quantity: -1 }],
      [{ side: 'buy', symbol: 'A01', quantity: 1.5 }],
    ];

    for (const operations of invalidOperations) {
      const result = await postJson('/api/simulations/preview', { operations });
      expect(result.status).toBe(400);
      expect(result.body.error).toBeDefined();
      expect(result.body.simulated).toBeUndefined();
    }
  });

  it('AC-05: persists AC-03, reopens it and keeps the original portfolio unchanged', async () => {
    const operations = [
      { side: 'sell', symbol: 'A01', quantity: 100 },
      { side: 'buy', symbol: 'A02', quantity: 100 },
    ];
    const saved = await postJson('/api/scenarios', { name: 'AC-03 验收方案', operations });
    expect(saved.status).toBe(201);

    const reopened = await request(`/api/scenarios/${saved.body.scenarioId}`);
    expect(reopened.status).toBe(200);
    expect(reopened.body.result.summary).toMatchObject({ totalAsset: '100000.00', cash: '25000.00' });
    expect(reopened.body.result.invariant.isPreserved).toBe(true);

    const original = await request('/api/portfolio');
    expect(original.body.summary.cash).toBe('20000.00');
    expect(original.body.instruments.find((item: { symbol: string }) => item.symbol === 'A01')?.quantity).toBe(400);
    expect(original.body.instruments.find((item: { symbol: string }) => item.symbol === 'A02')?.quantity).toBe(400);
  });
});
