// SPEC §20 — Registry + autonomy/threshold gates per §20.3.
import type { AutonomyLevel } from "./Skill";
import { Skill } from "./Skill";
import { ResearchOrgSkill } from "./ResearchOrgSkill";
import { ResearchPersonSkill } from "./ResearchPersonSkill";
import { DraftTouchSkill } from "./DraftTouchSkill";
import { SummarizeThreadSkill } from "./SummarizeThreadSkill";
import { CaptureCallSkill } from "./CaptureCallSkill";
import { InferEdgesSkill } from "./InferEdgesSkill";
import { GeocodeSkill } from "./GeocodeSkill";
import { TranscribeSkill } from "./TranscribeSkill";
import { RouteIntroductionSkill } from "./RouteIntroductionSkill";
import { ImportContactsSkill } from "./ImportContactsSkill";
import { ExportGraphSkill } from "./ExportGraphSkill";
import { ScheduleTouchSkill } from "./ScheduleTouchSkill";
import { SummarizeWeekSkill } from "./SummarizeWeekSkill";
import { MergeDuplicatesSkill } from "./MergeDuplicatesSkill";
import { VerifyEmailSkill } from "./VerifyEmailSkill";
import { ReviewChangesSkill } from "./ReviewChangesSkill";

export interface SkillSettings {
  enabled: boolean;
  autonomy: AutonomyLevel;
  providerOverride?: string;
}

export class SkillRegistry {
  private skills = new Map<string, Skill>();
  private settings = new Map<string, SkillSettings>();

  constructor() {
    for (const s of [
      new ResearchOrgSkill(),
      new ResearchPersonSkill(),
      new DraftTouchSkill(),
      new SummarizeThreadSkill(),
      new CaptureCallSkill(),
      new InferEdgesSkill(),
      new GeocodeSkill(),
      new TranscribeSkill(),
      new RouteIntroductionSkill(),
      new ImportContactsSkill(),
      new ExportGraphSkill(),
      new ScheduleTouchSkill(),
      new SummarizeWeekSkill(),
      new MergeDuplicatesSkill(),
      new VerifyEmailSkill(),
      new ReviewChangesSkill(),
    ]) {
      this.skills.set(s.id, s);
      this.settings.set(s.id, { enabled: true, autonomy: "propose" });
    }
  }

  list(): Skill[] {
    return [...this.skills.values()];
  }
  get(id: string): Skill | undefined {
    return this.skills.get(id);
  }
  enabled(): Skill[] {
    return this.list().filter(
      (s) => this.settings.get(s.id)?.enabled !== false,
    );
  }
  setSettings(id: string, s: Partial<SkillSettings>): void {
    const cur = this.settings.get(id) ?? { enabled: true, autonomy: "propose" };
    this.settings.set(id, { ...cur, ...s });
  }
  getSettings(id: string): SkillSettings {
    return this.settings.get(id) ?? { enabled: true, autonomy: "propose" };
  }
}
