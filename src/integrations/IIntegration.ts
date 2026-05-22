// SPEC §§21-27 — Common integration contract.
export type IntegrationId = 'google_workspace' | 'microsoft_365' | 'apple' | 'notion' | 'twilio' | 'smtp_imap' | 'web_search' | string;
export type SyncFrequency = 'realtime' | '1m' | '5m' | '15m' | '1h' | '6h' | 'daily' | 'manual';
export interface SyncResource { id: string; label: string; frequency: SyncFrequency; enabled: boolean; lastPullTs: number | null; cursor: string | null; }
export interface ConnectionState { connected: boolean; account?: string; expiresAt?: number; }

export interface IIntegration {
  readonly id: IntegrationId;
  readonly label: string;
  connect(): Promise<ConnectionState>;
  disconnect(): Promise<void>;
  state(): Promise<ConnectionState>;
  listResources(): Promise<SyncResource[]>;
  syncResource(id: string): Promise<{ pulled: number; pushed: number; errors: number }>;
}
