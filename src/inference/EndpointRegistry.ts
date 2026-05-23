import { PluginSettings } from "../settings/PluginSettings";

interface EndpointDiscoveryEvent {
  type: "endpointDiscovery";
  endpoints: string[];
}

interface ServiceBus {
  emit(event: EndpointDiscoveryEvent): void;
}

class EndpointRegistry {
  private settings: PluginSettings;
  private endpoints: Set<string>;

  constructor(settings: PluginSettings) {
    this.settings = settings;
    this.endpoints = new Set(settings.endpoints || []);
  }

  async addEndpoint(endpoint: string): Promise<void> {
    this.endpoints.add(endpoint);
    await this.persistEndpoints();
  }

  private async persistEndpoints(): Promise<void> {
    this.settings.endpoints = Array.from(this.endpoints);
    if (this.settings.save) await this.settings.save();
  }

  getEndpoints(): string[] {
    return Array.from(this.endpoints);
  }

  emitDiscoveryEvent(serviceBus: ServiceBus): void {
    const event: EndpointDiscoveryEvent = {
      type: "endpointDiscovery",
      endpoints: this.getEndpoints(),
    };
    serviceBus.emit(event);
  }
}

export type { EndpointDiscoveryEvent };
export { EndpointRegistry };
