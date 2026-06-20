import { TFile } from "obsidian";
import { Entity } from "./Entity";
import { Person } from "./Person";
import { Org } from "./Org";
import { Subsidiary } from "./Subsidiary";
import { Touch } from "./Touch";
import { Addendum } from "./Addendum";
import { KnowledgeNote } from "./KnowledgeNote";
import { Idea } from "./Idea";
import { Observation } from "./Observation";
import { TaskEntity } from "./TaskEntity";
import { EventEntity } from "./EventEntity";
import { PipelineDeal } from "./PipelineDeal";
import { UserAgent } from "./UserAgent";
import { SubVault } from "./SubVault";
import { ParentVault } from "./ParentVault";

export function entityFromFrontmatter(
  file: TFile,
  fm: Record<string, any>,
): Entity | null {
  if (!fm || !fm.type) return null;
  switch (fm.type) {
    case Person.TYPE:
      return new Person(file, fm);
    case Org.TYPE:
      return fm.parent ? new Subsidiary(file, fm) : new Org(file, fm);
    case Subsidiary.SUBTYPE:
      return new Subsidiary(file, fm);
    case Touch.TYPE:
      return new Touch(file, fm);
    case Addendum.TYPE:
      return new Addendum(file, fm);
    case KnowledgeNote.TYPE:
      return new KnowledgeNote(file, fm);
    case Idea.TYPE:
      return new Idea(file, fm);
    case Observation.TYPE:
      return new Observation(file, fm);
    case TaskEntity.TYPE:
      return new TaskEntity(file, fm);
    case EventEntity.TYPE:
      return new EventEntity(file, fm);
    case PipelineDeal.TYPE:
      return new PipelineDeal(file, fm);
    case UserAgent.TYPE:
      return new UserAgent(file, fm);
    case SubVault.TYPE:
      return new SubVault(file, fm);
    case ParentVault.TYPE:
      return new ParentVault(file, fm);
    default:
      return null;
  }
}
