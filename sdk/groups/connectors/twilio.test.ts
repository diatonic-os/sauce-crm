import { describe, it, expect } from 'vitest';
import { buildSmsRequest, parseSmsResponse } from './twilio';

const cfg = { accountSid: 'AC123', authToken: 'tok' };

describe('connectors/twilio', () => {
  it('builds a Basic-auth, form-encoded send request', () => {
    const req = buildSmsRequest('+1222', '+1333', 'hi there', cfg);
    expect(req.url).toContain('/Accounts/AC123/Messages.json');
    expect(req.method).toBe('POST');
    expect(req.headers?.Authorization).toBe(`Basic ${btoa('AC123:tok')}`);
    expect(req.headers?.['Content-Type']).toBe('application/x-www-form-urlencoded');
    expect(req.body).toContain('To=%2B1222');
    expect(req.body).toContain('Body=hi+there');
  });

  it('parses a message response; missing fields → empty strings', () => {
    expect(parseSmsResponse({ sid: 'SM1', status: 'queued' })).toEqual({ sid: 'SM1', status: 'queued' });
    expect(parseSmsResponse(null)).toEqual({ sid: '', status: '' });
  });
});
