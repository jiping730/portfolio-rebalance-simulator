import { describe, expect, it } from 'vitest';
import App from './App';

describe('web bootstrap', () => {
  it('exports the root application component', () => {
    expect(typeof App).toBe('function');
  });
});
