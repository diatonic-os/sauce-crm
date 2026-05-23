import { describe, it, expect } from 'vitest';
import { buildSummarizeRequest, parseSummary } from './summarize-thread';

describe('skills/summarize-thread', () => {
  it('builds a Bearer JSON request', () => {
    const req = buildSummarizeRequest('hello\nworld', { apiKey: 'k' });
    expect(req.method).toBe('POST');
    expect(req.headers?.Authorization).toBe('Bearer k');
    expect(req.body).toContain('"task":"summarize"');
    expect(req.body).toContain('hello');
  });

  it('parses the summary; absent → empty string', () => {
    expect(parseSummary({ summary: 'short recap' })).toBe('short recap');
    expect(parseSummary(null)).toBe('');
  });
});
