import { describe, it, expect } from 'vitest';
import { researchOrg } from './research-org';

describe('skills/research-org', () => {
  it('returns the org and a sources array', async () => {
    const r = await researchOrg('Acme', { apiKey: 'k' });
    expect(r.org).toBe('Acme');
    expect(Array.isArray(r.sources)).toBe(true);
  });
});
