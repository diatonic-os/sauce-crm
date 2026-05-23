import { describe, it, expect } from 'vitest';
import { researchPerson } from './research-person';

describe('skills/research-person', () => {
  it('returns the name and a sources array', async () => {
    const r = await researchPerson('Frank', { apiKey: 'k' });
    expect(r.name).toBe('Frank');
    expect(Array.isArray(r.sources)).toBe(true); // stub yields [] (no results)
  });
});
