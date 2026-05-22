// SPEC §19.5 — Sessions saved under _addenda/_copilot/YYYY-MM-DD-<slug>.md.
import type { ChatMessage } from './ICopilotProvider';

export interface CopilotSession {
  id: string;
  createdTs: number;
  updatedTs: number;
  model: string;
  provider: string;
  skillSet: string[];
  messages: ChatMessage[];
  tokenIn: number;
  tokenOut: number;
}

export interface ConversationHost {
  readJson<T>(path: string): Promise<T | null>;
  writeMarkdown(path: string, frontmatter: Record<string, unknown>, body: string): Promise<void>;
  list(dir: string): Promise<string[]>;
}

function isoDate(ts: number): string { return new Date(ts).toISOString().slice(0, 10); }
function slug(s: string): string { return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'session'; }

export class ConversationStore {
  constructor(private readonly host: ConversationHost, private readonly root = '_addenda/_copilot') {}

  pathFor(s: CopilotSession, titleHint = ''): string {
    return `${this.root}/${isoDate(s.createdTs)}-${slug(titleHint || s.id)}.md`;
  }

  async save(s: CopilotSession, titleHint = ''): Promise<string> {
    const path = this.pathFor(s, titleHint);
    const body = s.messages.map((m) => `### ${m.role}\n\n${typeof m.content === 'string' ? m.content : JSON.stringify(m.content, null, 2)}\n`).join('\n');
    await this.host.writeMarkdown(path, {
      type: 'copilot-session',
      session_id: s.id, model: s.model, provider: s.provider,
      created: new Date(s.createdTs).toISOString(),
      updated: new Date(s.updatedTs).toISOString(),
      skills: s.skillSet, tokens_in: s.tokenIn, tokens_out: s.tokenOut,
    }, body);
    return path;
  }
}
