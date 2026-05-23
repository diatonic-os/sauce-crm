import { EndpointProbe } from '../src/inference/EndpointProbe';

describe('EndpointProbe', () => {
  it('should probe a valid endpoint', async () => {
    const probe = new EndpointProbe();
    const result = await probe.probe('https://example.com');
    expect(result.success).toBe(true);
  });

  it('should fail to probe an invalid endpoint', async () => {
    const probe = new EndpointProbe();
    const result = await probe.probe('http://localhost:9999');
    expect(result.success).toBe(false);
  });

  it('should throw an error for an invalid URL', async () => {
    const probe = new EndpointProbe();
    await expect(probe.probe('not-a-url')).rejects.toThrow('Invalid URL: not-a-url');
  });
});
