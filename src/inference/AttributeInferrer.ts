// SPEC §31.1 — company/title from email signatures + repeated mentions.
import { combineSignals, verdict, DEFAULT_THRESHOLDS, type Verdict } from './ConfidenceModel';

export interface AttributeProposal { entityId: string; attribute: string; value: string; confidence: number; verdict: Verdict; sources: string[]; }

const SIG_COMPANY_RX = /^(?:[\w&,.\s-]+)\s*$/m;

export class AttributeInferrer {
  inferCompanyFromSignature(entityId: string, signatureLines: string[], sourceId: string): AttributeProposal | null {
    for (const line of signatureLines) {
      const m = SIG_COMPANY_RX.exec(line.trim());
      if (m && line.length > 2 && line.length < 80 && !/^https?:\/\//.test(line) && !/@/.test(line)) {
        const conf = combineSignals([1.0], [0.7]);
        return { entityId, attribute: 'company', value: line.trim(), confidence: conf, verdict: verdict(conf, DEFAULT_THRESHOLDS.company), sources: [sourceId] };
      }
    }
    return null;
  }
}
