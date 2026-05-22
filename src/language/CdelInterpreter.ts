// SPEC §32 — Interprets parsed CDEL into skill invocations.
import type { CdelNode, CdelDirective } from './CdelParser';
import { lex } from './CdelLexer';
import { parse } from './CdelParser';
import { IdiomCatalog } from './IdiomCatalog';

export interface CdelDispatch { skillId: string; args: Record<string, unknown>; source: 'directive' | 'natural'; }
export interface CdelInterpretResult { dispatches: CdelDispatch[]; unhandled: string[]; }

const VERB_TO_SKILL: Record<string, string> = {
  person: 'cdel.create-person',
  org: 'cdel.create-org',
  touch: 'cdel.create-touch',
  addendum: 'cdel.create-addendum',
  intro: 'route-introduction',
  tag: 'cdel.tag-op',
  relation: 'cdel.relation-op',
  'sub-vault': 'cdel.sub-vault',
};

export class CdelInterpreter {
  constructor(private readonly idioms = new IdiomCatalog(), private readonly strictness: 'warn' | 'block' | 'best-guess' = 'best-guess') {}

  interpret(source: string): CdelInterpretResult {
    const dispatches: CdelDispatch[] = [];
    const unhandled: string[] = [];
    const expanded: string[] = [];
    for (const rawLine of source.split('\n')) {
      const r = this.idioms.rewriteIfMatch(rawLine.trim());
      expanded.push(r ?? rawLine);
    }
    const nodes: CdelNode[] = parse(lex(expanded.join('\n')));
    for (const n of nodes) {
      if (n.kind === 'directive') {
        const d = n as CdelDirective;
        const skillId = VERB_TO_SKILL[d.verb];
        if (!skillId) { unhandled.push(`unknown verb @${d.verb}`); continue; }
        dispatches.push({
          skillId, source: 'directive',
          args: { subject: d.subject, target: d.target ?? null, metadata: d.metadata, body: d.body ?? '' },
        });
      } else {
        if (this.strictness === 'block') unhandled.push(n.text);
        else dispatches.push({ skillId: 'cdel.natural', args: { text: n.text }, source: 'natural' });
      }
    }
    return { dispatches, unhandled };
  }
}
