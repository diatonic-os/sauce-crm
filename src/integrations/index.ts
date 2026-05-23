export * from "./IIntegration";
export { GoogleWorkspaceIntegration } from "./google";
export { Microsoft365Integration } from "./microsoft";
export { AppleIntegration } from "./apple";
export { NotionIntegration } from "./notion";
export { TwilioIntegration } from "./twilio";
export { SmtpImapIntegration } from "./smtpimap";
export { BraveSearch, TavilySearch, SearXNGSearch } from "./websearch";
export { AutoTouchPipeline } from "./AutoTouchPipeline";
export type {
  CalendarEventSummary,
  TouchDraft,
  AutoTouchOpts,
} from "./AutoTouchPipeline";
export { parseSignature, extractSignatureBlock } from "./SignatureParser";
export type { ParsedSignature } from "./SignatureParser";
