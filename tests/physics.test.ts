import { describe, expect, it } from 'vitest';
import { runAllTests } from '../src/validation/suite';

describe('gravity-lab physics validation suite', () => {
  const results = runAllTests();
  for (const r of results) {
    it(`${r.name} — ${r.measured}`, () => {
      expect(r.pass, `${r.name}\n  measured: ${r.measured}\n  tolerance: ${r.tolerance}`).toBe(true);
    });
  }
});
