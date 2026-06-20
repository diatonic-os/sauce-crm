// Adapter: vault frontmatter → the pure MapData consumed by EntityCard.
// Keeps the obsidian dependency OUT of the tested harness modules — this is the
// one place that reads the vault and normalizes it into plain data, so
// buildEntityCard / buildConnectionMatrix stay pure and unit-tested.

import type { App } from "obsidian";
import type {
  MapData,
  PersonRef,
  OrgRef,
  TouchRef,
  IdeaRef,
} from "../saucebot/harness/EntityCard";

/** Strip `[[wikilink]]` / alias syntax → bare target name (our entity id). */
function unlink(v: unknown): string {
  if (typeof v !== "string") return "";
  const m = v.match(/\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/);
  return (m ? m[1]! : v).trim();
}

function unlinkList(v: unknown): string[] {
  if (Array.isArray(v)) return v.map(unlink).filter(Boolean);
  if (typeof v === "string" && v) return [unlink(v)];
  return [];
}

/**
 * Scan the vault once and project person / org / touch / idea notes into the
 * pure MapData shape. Entity id = file basename (matches `[[Name]]` targets).
 */
export function buildMapDataFromVault(app: App): MapData {
  const people: PersonRef[] = [];
  const orgs: OrgRef[] = [];
  const touches: TouchRef[] = [];
  const ideas: IdeaRef[] = [];

  for (const f of app.vault.getMarkdownFiles()) {
    const fm = app.metadataCache.getFileCache(f)?.frontmatter;
    if (!fm) continue;
    const id = f.basename;
    const type = String(fm.type ?? "");

    if (type === "warm-contact" || type === "person") {
      const ref: PersonRef = {
        id,
        name: id,
        knows: unlinkList(fm.knows),
        workedWith: unlinkList(fm.worked_with),
      };
      const org = unlink(fm.org ?? fm.primary_org);
      if (org) ref.org = org;
      people.push(ref);
    } else if (type === "org") {
      orgs.push({ id, name: id, members: unlinkList(fm.members) });
    } else if (type === "touch") {
      const person = unlink(fm.contact);
      if (!person) continue;
      const ref: TouchRef = { id, person, date: String(fm.date ?? "") };
      const org = unlink(fm.org);
      if (org) ref.org = org;
      const summary = typeof fm.summary === "string" ? fm.summary : "";
      if (summary) ref.summary = summary;
      touches.push(ref);
    } else if (type === "idea") {
      ideas.push({
        id,
        title: typeof fm.title === "string" ? fm.title : id,
        about: unlinkList(fm.about ?? fm.related),
      });
    }
  }
  return { people, orgs, touches, ideas };
}
