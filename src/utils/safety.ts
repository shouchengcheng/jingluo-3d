/**
 * Clinical needling safety extraction (UI audit 6.2).
 * Parses the free-text `clinical.operation` field and surfaces contraindication / caution clauses
 * as a distinct red (danger) or amber (caution) warning block above the card sections.
 */
export type SafetyLevel = 'danger' | 'caution';

export interface SafetyNotice {
  level: SafetyLevel;
  clauses: string[];
}

const DANGER_RE = /禁针|严禁|切忌|切勿|禁刺|一般不针|延髓|脊髓|气胸|心脏|肺尖|肝左叶|伤及肺|刺穿胸膜/;
const CAUTION_RE = /禁灸|慎|不宜|不可|孕妇|勿|谨防|排空小便|囟门|血管|动脉|严格掌握/;

export function extractSafetyNotice(operation: string | undefined | null): SafetyNotice | null {
  if (!operation) return null;
  const clauses = operation
    .split(/[；;。]/)
    .map((s) => s.trim())
    .filter(Boolean);

  const dangerClauses = clauses.filter((c) => DANGER_RE.test(c));
  const cautionClauses = clauses.filter((c) => !DANGER_RE.test(c) && CAUTION_RE.test(c));

  if (dangerClauses.length > 0) {
    return { level: 'danger', clauses: [...dangerClauses, ...cautionClauses] };
  }
  if (cautionClauses.length > 0) {
    return { level: 'caution', clauses: cautionClauses };
  }
  return null;
}
