// V2 view exports. Each view extends Obsidian's ItemView and registers
// its capability with `plugin.v2Registry` on mount so the settings tab
// status row can render IMPLEMENTED / DEGRADED / COMING_SOON correctly.
export { MapView, VIEW_MAP } from "./MapView";
export { AIInboxView, VIEW_AI_INBOX } from "./AIInboxView";
export { SyncStatusView, VIEW_SYNC_STATUS } from "./SyncStatusView";
export { AuditLogView, VIEW_AUDIT_LOG } from "./AuditLogView";
export {
  SkillRunLogView,
  VIEW_SKILL_RUN_LOG,
  skillRunRing,
} from "./SkillRunLogView";
export { SauceBotChatView, VIEW_COPILOT_CHAT } from "./SauceBotChatView";

export const V2_VIEW_TYPES = [
  "sauce-map",
  "sauce-ai-inbox",
  "sauce-copilot-chat",
  "sauce-sync-status",
  "sauce-audit-log",
  "sauce-skill-run-log",
] as const;
