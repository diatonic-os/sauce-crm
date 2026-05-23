import { requestUrl, RequestUrlParam } from 'obsidian';

interface EndpointProbeResult {
  success: boolean;
  endpoint: string;
  error?: string;
}

class EndpointProbe {
  async probe(url: string): Promise<EndpointProbeResult> {
    try {
      const requestParams: RequestUrlParam = {
        url,
        method: 'GET',
        throw: true,
        headers: {
          'Content-Type': 'application/json',
        },
      };
      const response = await requestUrl(requestParams);

      if (response.status === 200) {
        return { success: true, endpoint: url };
      } else {
        return { success: false, endpoint: url, error: `Status code ${response.status}` };
      }
    } catch (error) {
      if (error instanceof Error) {
        return { success: false, endpoint: url, error: error.message };
      } else {
        return { success: false, endpoint: url, error: 'Unknown error' };
      }
    }
  }
}

export { EndpointProbe };
