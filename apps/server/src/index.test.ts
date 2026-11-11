import { describe, expect, it } from 'vitest';
import { app } from './index.js';

describe('server bootstrap', () => {
  it('exports an Express application', () => {
    expect(typeof app).toBe('function');
  });
});
