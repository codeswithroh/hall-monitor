/**
 * Deterministic mapping from tracker category to COPPA provisions (16 CFR Part 312, as amended in 2025).
 * Kept as plain rules, not an LLM call, so every node reaches the same finding and a lawyer can audit
 * the logic. This flags exposure for a human reviewer; it is not a legal conclusion.
 *
 * Verify citations against the current eCFR text before relying on them.
 */
import { Category } from "./trackers"

export enum Severity {
  None = 0,
  Review = 1,
  Medium = 2,
  High = 3,
}

export type Provision = { cite: string; summary: string }

const PI_PERSISTENT_ID: Provision = {
  cite: "16 CFR 312.2 (\"personal information\")",
  summary: "A persistent identifier that can recognize a user over time and across sites is personal information.",
}
const VPC_REQUIRED: Provision = {
  cite: "16 CFR 312.5(a)(1)",
  summary: "Verifiable parental consent is required before collecting personal information from a child.",
}
const SEPARATE_CONSENT_THIRD_PARTY: Provision = {
  cite: "16 CFR 312.5(a)(2) (2025 amendment)",
  summary: "Disclosure to third parties, e.g. for targeted advertising, needs separate parental consent.",
}
const INTERNAL_OPS_LIMIT: Provision = {
  cite: "16 CFR 312.5(c)(7); 312.2 (\"support for the internal operations\")",
  summary:
    "The internal-operations exception does not cover behavioral advertising or profiling; analytics may qualify only if limited to that purpose.",
}
const OPERATOR_LIABILITY: Provision = {
  cite: "16 CFR 312.2 (\"operator\")",
  summary: "A child-directed site is responsible for third parties it lets collect personal information on its pages.",
}

export type Finding = { severity: Severity; provisions: Provision[]; rationale: string }

export const assess = (category: Category, childDirected: boolean): Finding => {
  if (!childDirected) {
    return { severity: Severity.None, provisions: [], rationale: "Page is not declared child-directed." }
  }
  switch (category) {
    case Category.Advertising:
      return {
        severity: Severity.High,
        provisions: [PI_PERSISTENT_ID, VPC_REQUIRED, SEPARATE_CONSENT_THIRD_PARTY, OPERATOR_LIABILITY],
        rationale: "Ad-tech loaded before any parental-consent gate collects persistent identifiers for advertising.",
      }
    case Category.SessionReplay:
    case Category.Fingerprinting:
      return {
        severity: Severity.High,
        provisions: [PI_PERSISTENT_ID, VPC_REQUIRED, OPERATOR_LIABILITY],
        rationale: "Records interaction data or device fingerprints, which go beyond internal operations.",
      }
    case Category.Social:
      return {
        severity: Severity.Medium,
        provisions: [PI_PERSISTENT_ID, VPC_REQUIRED, OPERATOR_LIABILITY],
        rationale: "Social plugins set or read cross-site identifiers from the child's browser.",
      }
    case Category.Analytics:
      return {
        severity: Severity.Review,
        provisions: [PI_PERSISTENT_ID, INTERNAL_OPS_LIMIT],
        rationale: "May fall under the internal-operations exception; needs review of configuration and data sharing.",
      }
    case Category.TagManager:
      return {
        severity: Severity.Review,
        provisions: [OPERATOR_LIABILITY],
        rationale: "Loads other tags at runtime; what it injects is not visible in static HTML.",
      }
    default:
      return {
        severity: Severity.Review,
        provisions: [OPERATOR_LIABILITY],
        rationale: "Unclassified third-party host; needs manual review.",
      }
  }
}
