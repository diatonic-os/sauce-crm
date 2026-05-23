import { describe, expect, it } from "vitest";
import { renderCanonEntity } from "../../../src/ui/views/CanonViewRenderer";

describe("renderCanonEntity", () => {
  it("renders title, type badge, and sorted frontmatter fields from structured data only", () => {
    const root = document.createElement("div");
    renderCanonEntity(root, {
      type: "ENT-people",
      frontmatter: {
        name: "Alice",
        tags: ["vip", "warm"],
        company: "Acme",
        sauce: { canonized: true },
      },
    });
    expect(root.querySelector(".sauce-canon-title")?.textContent).toBe("Alice");
    expect(root.querySelector(".sauce-badge--canon")?.textContent).toBe(
      "ENT-people",
    );
    const keys = [...root.querySelectorAll(".sauce-canon-key")].map(
      (k) => k.textContent,
    );
    expect(keys).toEqual(["company", "name", "tags"]); // sorted; `sauce` hidden
    const tagsVal = [...root.querySelectorAll(".sauce-canon-val")].find(
      (_, i) => keys[i] === "tags",
    );
    expect(tagsVal?.textContent).toBe("vip, warm");
  });

  it("renders structured body markers (never freeform text) and uses tokenized classes only (G-001)", () => {
    const root = document.createElement("div");
    renderCanonEntity(root, {
      type: "ENT-notes",
      frontmatter: { title: "Note A" },
      markers: { summary: "A structured summary block." },
    });
    const marker = root.querySelector(".sauce-canon-marker");
    expect(marker?.getAttribute("data-marker")).toBe("summary");
    expect(root.querySelector(".sauce-canon-marker-body")?.textContent).toBe(
      "A structured summary block.",
    );
    expect(root.querySelectorAll("[style]")).toHaveLength(0);
  });

  it("re-render clears prior content (idempotent projection)", () => {
    const root = document.createElement("div");
    renderCanonEntity(root, {
      type: "ENT-notes",
      frontmatter: { title: "One" },
    });
    renderCanonEntity(root, {
      type: "ENT-notes",
      frontmatter: { title: "Two" },
    });
    expect(root.querySelectorAll(".sauce-canon-view")).toHaveLength(1);
    expect(root.querySelector(".sauce-canon-title")?.textContent).toBe("Two");
  });
});
