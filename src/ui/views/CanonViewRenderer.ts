// CON-OBS-INTEG-001 · T-D-03 — renders a canonized entity as HTML from its
// frontmatter + structured body markers. It NEVER parses freeform user text —
// only declared frontmatter fields and `sauce:`-prefixed body markers — so the
// rendered view is a faithful, non-lossy projection of structured data.
//
// Standard DOM + tokenized `sauce-*` classes only (G-001). jsdom-testable.

export interface CanonEntity {
  /** ENT-<id> (from frontmatter sauce.type). */
  type: string;
  frontmatter: Record<string, unknown>;
  /** Pre-extracted structured body markers (e.g. `sauce:summary` blocks). NOT freeform text. */
  markers?: Record<string, string>;
}

/** Keys never shown as data rows (rendering/control metadata). */
const HIDDEN_KEYS = new Set(["position", "sauce"]);

function fmtValue(value: unknown): string {
  if (Array.isArray(value)) return value.map((v) => String(v)).join(", ");
  if (value === null || value === undefined) return "";
  return String(value);
}

/** Render the entity into `containerEl`, returning the root card element. */
export function renderCanonEntity(
  containerEl: HTMLElement,
  entity: CanonEntity,
): HTMLElement {
  containerEl.replaceChildren();

  const card = document.createElement("div");
  card.className = "sauce-canon-view";
  card.dataset.entityType = entity.type;

  const head = document.createElement("div");
  head.className = "sauce-canon-head";
  const title = document.createElement("h2");
  title.className = "sauce-canon-title";
  title.textContent = fmtValue(
    entity.frontmatter.name ?? entity.frontmatter.title ?? entity.type,
  );
  const badge = document.createElement("span");
  badge.className = "sauce-badge sauce-badge--canon";
  badge.textContent = entity.type;
  head.appendChild(title);
  head.appendChild(badge);
  card.appendChild(head);

  // Frontmatter fields as a definition list (sorted, deterministic).
  const dl = document.createElement("dl");
  dl.className = "sauce-canon-fields";
  for (const key of Object.keys(entity.frontmatter).sort()) {
    if (HIDDEN_KEYS.has(key)) continue;
    const dt = document.createElement("dt");
    dt.className = "sauce-canon-key";
    dt.textContent = key;
    const dd = document.createElement("dd");
    dd.className = "sauce-canon-val";
    dd.textContent = fmtValue(entity.frontmatter[key]);
    dl.appendChild(dt);
    dl.appendChild(dd);
  }
  card.appendChild(dl);

  // Structured body markers (never freeform text).
  if (entity.markers) {
    for (const name of Object.keys(entity.markers).sort()) {
      const section = document.createElement("section");
      section.className = "sauce-canon-marker";
      section.dataset.marker = name;
      const h = document.createElement("h3");
      h.className = "sauce-canon-marker-title";
      h.textContent = name;
      const p = document.createElement("p");
      p.className = "sauce-canon-marker-body";
      p.textContent = entity.markers[name] ?? null; // name from Object.keys — always present; null for textContent API
      section.appendChild(h);
      section.appendChild(p);
      card.appendChild(section);
    }
  }

  containerEl.appendChild(card);
  return card;
}
