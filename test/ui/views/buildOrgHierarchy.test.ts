import { describe, expect, it } from "vitest";
import { TFile } from "obsidian";
import { Org } from "../../../src/domain/Org";
import { buildOrgHierarchy } from "../../../src/ui/views/Views";

function org(name: string, parent?: string): Org {
  const file = new TFile(`orgs/${name}.md`);
  return new Org(file, parent ? { type: "org", parent } : { type: "org" });
}

describe("buildOrgHierarchy", () => {
  it("computes tops and children from the typed Org.parent getter (wikilink stripped)", () => {
    const orgs = [
      org("Acme"),
      org("Acme Cloud", "[[Acme]]"),
      org("Acme Labs", "[[Acme|the parent]]"),
      org("Globex"),
    ];
    const { tops, children } = buildOrgHierarchy(orgs);

    expect(tops.sort()).toEqual(["Acme", "Globex"]);
    expect(children.get("Acme")?.sort()).toEqual(["Acme Cloud", "Acme Labs"]);
    expect(children.has("Globex")).toBe(false);
  });

  it("treats orgs with no parent (Org.isSubsidiary() === false) as roots", () => {
    const orgs = [org("Solo")];
    expect(orgs[0]!.isSubsidiary()).toBe(false);
    const { tops, children } = buildOrgHierarchy(orgs);
    expect(tops).toEqual(["Solo"]);
    expect(children.size).toBe(0);
  });

  it("treats an org whose parent is absent from the set as a top-level root", () => {
    const orgs = [org("Orphan", "[[Missing Parent]]")];
    const { tops } = buildOrgHierarchy(orgs);
    expect(tops).toEqual(["Orphan"]);
  });
});
