// SPEC §31 — Inference orchestrator. Inferences become `Inference` entities (§31.2).
import { EdgeInferrer, type EdgeProposal, type TouchRecord } from './EdgeInferrer';
import { AttributeInferrer, type AttributeProposal } from './AttributeInferrer';
import { MergeProposer, type MergeCandidate, type CandidateRecord } from './MergeProposer';

export interface InferenceEntity {
  type: 'inference';
  inference_kind: 'edge' | 'attribute' | 'merge' | 'geocode' | 'role' | 'tag';
  target: string;
  proposed_value: unknown;
  confidence: number;
  sources: string[];
  status: 'proposed' | 'accepted' | 'rejected' | 'expired';
  expires?: string;
}

export class InferenceEngine {
  readonly edges = new EdgeInferrer();
  readonly attributes = new AttributeInferrer();
  readonly merges = new MergeProposer();

  edgeProposals(touches: TouchRecord[]): InferenceEntity[] {
    return this.edges.inferFrom(touches).map((p: EdgeProposal) => this.toInference('edge', `${p.fromId}--${p.edgeType}-->${p.toId}`, { edgeType: p.edgeType }, p.confidence, p.sources));
  }
  mergeProposals(records: CandidateRecord[]): InferenceEntity[] {
    return this.merges.propose(records).map((m: MergeCandidate) => this.toInference('merge', m.aId, { mergeWith: m.bId, reason: m.reason }, m.confidence, []));
  }
  attributeProposalsFromSignature(entityId: string, sigLines: string[], sourceId: string): InferenceEntity[] {
    const a = this.attributes.inferCompanyFromSignature(entityId, sigLines, sourceId);
    return a ? [this.toInference('attribute', entityId, { attribute: a.attribute, value: a.value }, a.confidence, a.sources)] : [];
  }
  private toInference(kind: InferenceEntity['inference_kind'], target: string, value: unknown, confidence: number, sources: string[]): InferenceEntity {
    return { type: 'inference', inference_kind: kind, target, proposed_value: value, confidence, sources, status: 'proposed' };
  }
}
