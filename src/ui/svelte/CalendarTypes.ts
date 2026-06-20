// Shared types for the Svelte Calendar component. Lives in a .ts file
// (not the .svelte) so TypeScript sees it cleanly from the host
// CalendarView without needing svelte type-shim plumbing.

export interface CalendarEvent {
  date: string; // ISO YYYY-MM-DD
  kind: "touch" | "task" | "followup" | "event";
  label: string;
  path?: string; // optional vault path for click-through
  quadrant?: "do" | "schedule" | "delegate" | "eliminate";
}
