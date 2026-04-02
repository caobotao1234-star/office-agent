import { describe, it, expect } from 'vitest';
import { VERSION } from './index.js';

describe('office-agent', () => {
  it('should export version', () => {
    expect(VERSION).toBe('0.1.0');
  });
});
