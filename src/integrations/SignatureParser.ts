// SPEC §22.1 "signature parsing". Heuristic best-effort email signature parser.
// Pure, deterministic, no regex catastrophe surface.

export interface ParsedSignature {
  raw: string;
  name?: string;
  title?: string;
  company?: string;
  email?: string;
  phones: string[];
  urls: string[];
  social: { linkedin?: string; twitter?: string; github?: string };
}

const SIG_DELIMITERS = [
  "-- ",
  "--",
  "___",
  "===",
  "Sent from my",
  "Best,",
  "Regards,",
  "Cheers,",
  "Thanks,",
];

export function extractSignatureBlock(body: string): string {
  if (!body) return "";
  const lines = body.split(/\r?\n/);
  // Find earliest delimiter line, take everything after
  let cut = -1;
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i]!.trim(); // i < lines.length — bounds-checked
    if (SIG_DELIMITERS.some((d) => t === d || t.startsWith(d))) {
      cut = i;
      break;
    }
  }
  if (cut === -1) {
    // Fallback: last 8 non-empty lines
    const nonEmpty = lines.filter((l) => l.trim());
    return nonEmpty.slice(-8).join("\n");
  }
  return lines
    .slice(cut + 1)
    .join("\n")
    .trim();
}

const EMAIL_CHARS = /[a-zA-Z0-9._%+-]/;

function extractEmails(text: string): string[] {
  const out: string[] = [];
  let i = 0;
  while (i < text.length) {
    const at = text.indexOf("@", i);
    if (at === -1) break;
    let l = at - 1;
    while (l >= 0 && EMAIL_CHARS.test(text[l]!)) l--; // l >= 0 bounds-checked
    let r = at + 1;
    while (r < text.length && EMAIL_CHARS.test(text[r]!)) r++; // r < text.length bounds-checked
    if (r > at + 1 && l + 1 < at && text.slice(at + 1, r).includes(".")) {
      out.push(text.slice(l + 1, r));
    }
    i = r + 1;
  }
  return [...new Set(out)];
}

function extractPhones(text: string): string[] {
  const out: string[] = [];
  const tokens = text.split(/[^\d+()\s.x-]+/);
  for (const tok of tokens) {
    const digits = tok.replace(/\D/g, "");
    if (digits.length >= 7 && digits.length <= 15) {
      out.push(tok.trim());
    }
  }
  return [...new Set(out)];
}

function extractUrls(text: string): string[] {
  const out: string[] = [];
  for (const word of text.split(/\s+/)) {
    if (word.startsWith("http://") || word.startsWith("https://"))
      out.push(word);
    else if (word.startsWith("www.")) out.push("https://" + word);
  }
  return [...new Set(out)];
}

function classifySocial(urls: string[]): {
  linkedin?: string;
  twitter?: string;
  github?: string;
} {
  const out: { linkedin?: string; twitter?: string; github?: string } = {};
  for (const u of urls) {
    if (!out.linkedin && /linkedin\.com\//i.test(u)) out.linkedin = u;
    else if (!out.twitter && /(twitter\.com|x\.com)\//i.test(u))
      out.twitter = u;
    else if (!out.github && /github\.com\//i.test(u)) out.github = u;
  }
  return out;
}

export function parseSignature(body: string): ParsedSignature {
  const raw = extractSignatureBlock(body);
  const lines = raw
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  const emails = extractEmails(raw);
  const phones = extractPhones(raw);
  const urls = extractUrls(raw);
  const social = classifySocial(urls);

  // Name = first non-empty line that isn't an email/url/phone
  let name: string | undefined;
  let title: string | undefined;
  let company: string | undefined;
  for (let i = 0; i < lines.length && i < 6; i++) {
    const l = lines[i]!; // i < lines.length — bounds-checked
    if (emails.some((e) => l.includes(e))) continue;
    if (urls.some((u) => l.includes(u))) continue;
    if (phones.some((p) => l.includes(p))) continue;
    if (!name) {
      name = l;
      continue;
    }
    if (!title) {
      title = l;
      continue;
    }
    if (!company) {
      company = l;
      continue;
    }
  }
  return {
    raw,
    ...(name !== undefined ? { name } : {}),
    ...(title !== undefined ? { title } : {}),
    ...(company !== undefined ? { company } : {}),
    ...(emails[0] !== undefined ? { email: emails[0] } : {}),
    phones,
    urls,
    social,
  };
}
