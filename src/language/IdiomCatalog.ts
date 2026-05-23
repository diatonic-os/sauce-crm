// SPEC §32.4 — Phrase patterns → CDEL directives.
export interface Idiom {
  pattern: RegExp;
  rewrite: (m: RegExpMatchArray) => string;
}

const TODAY = () => new Date().toISOString().slice(0, 10);
const ADD_DAYS = (n: number) =>
  new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);

export class IdiomCatalog {
  private idioms: Idiom[] = [
    {
      pattern: /^met with (.+?) today$/i,
      rewrite: (m) => `@touch ${m[1]} ${TODAY()} in-person`,
    },
    {
      pattern: /^called (.+?) about (.+)$/i,
      rewrite: (m) => `@touch ${m[1]} ${TODAY()} call | about ${m[2]}`,
    },
    {
      pattern: /^add (.+?) at (.+)$/i,
      rewrite: (m) => `@person ${m[1]}\n  company: [[${m[2]}]]`,
    },
    {
      pattern: /^(.+?) owns (.+)$/i,
      rewrite: (m) => `@org ${m[2]}\n  parent: [[${m[1]}]]`,
    },
    {
      pattern: /^intro (.+?) to (.+)$/i,
      rewrite: (m) => `@intro ${m[1]} -> ${m[2]}`,
    },
    {
      pattern: /^follow up with (.+?) in (\d+) days$/i,
      rewrite: (m) =>
        `- [ ] follow-up ${m[1]} 📅 ${ADD_DAYS(parseInt(m[2], 10))}`,
    },
  ];

  add(i: Idiom): void {
    this.idioms.push(i);
  }
  remove(index: number): void {
    this.idioms.splice(index, 1);
  }
  list(): Idiom[] {
    return [...this.idioms];
  }
  rewriteIfMatch(line: string): string | null {
    for (const i of this.idioms) {
      const m = line.match(i.pattern);
      if (m) return i.rewrite(m);
    }
    return null;
  }
}
