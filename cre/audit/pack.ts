/**
 * The evidence pack: a canonical JSON document built only from what the DON agreed on (page URL,
 * observation time, observed hosts). Its keccak256 goes onchain, so anyone holding the pack can
 * rebuild it with this same function and check the hash (tools/verify.ts).
 */
import { keccak256, toBytes } from "viem"
import { assess, Severity, type Provision } from "./coppa"
import type { Observation } from "./extract"
import { Category, lookupTracker } from "./trackers"

export const PACK_SCHEMA = "hall-monitor/evidence-pack@1"

/** How the observations were made. Part of the hashed pack, so each runner states its own method. */
export const DON_METHOD =
  "Each Chainlink DON node fetched the page independently and extracted third-party hosts from static HTML " +
  "(script/img/iframe/link tags and URLs in inline scripts). Only the host set agreed by consensus is recorded."
export const HOSTED_METHOD =
  "Hosted runner: three independent fetches of the page, each extracting third-party hosts from static HTML " +
  "(script/img/iframe/link tags and URLs in inline scripts). A host set at least two fetches agreed on is recorded. " +
  "Submitted through the Chainlink CRE mock forwarder on Ethereum Sepolia."

export type PackFinding = {
  host: string
  via: string
  entity: string
  category: keyof typeof Category
  severity: keyof typeof Severity
  rationale: string
  provisions: Provision[]
}

export type EvidencePack = {
  schema: string
  url: string
  observedAt: string
  audience: "child-directed" | "general"
  method: string
  summary: { thirdParties: number; high: number; medium: number; review: number }
  findings: PackFinding[]
  disclaimer: string
}

export type BuiltPack = {
  pack: EvidencePack
  json: string
  hash: `0x${string}`
  hosts: string[]
  categories: number[]
  severities: number[]
}

export const buildPack = (
  url: string,
  observedAtSec: number,
  childDirected: boolean,
  observations: Observation[],
  method: string = DON_METHOD,
): BuiltPack => {
  const rows = observations.map((o) => {
    const info = lookupTracker(o.host) ?? { entity: "Unknown third party", category: Category.Unknown }
    return { o, info, finding: assess(info.category, childDirected) }
  })

  const findings: PackFinding[] = rows.map(({ o, info, finding }) => ({
    host: o.host,
    via: o.via,
    entity: info.entity,
    category: Category[info.category] as keyof typeof Category,
    severity: Severity[finding.severity] as keyof typeof Severity,
    rationale: finding.rationale,
    provisions: finding.provisions,
  }))
  const count = (s: Severity) => rows.filter((r) => r.finding.severity === s).length

  const pack: EvidencePack = {
    schema: PACK_SCHEMA,
    url,
    observedAt: new Date(observedAtSec * 1000).toISOString(),
    audience: childDirected ? "child-directed" : "general",
    method,
    summary: {
      thirdParties: rows.length,
      high: count(Severity.High),
      medium: count(Severity.Medium),
      review: count(Severity.Review),
    },
    findings,
    disclaimer:
      "Automated observation flagged for legal review. Not a finding of liability. Scripts injected at runtime " +
      "are not visible to static extraction, so absence of a tracker here does not prove absence on the live page.",
  }

  const json = JSON.stringify(pack)
  return {
    pack,
    json,
    hash: keccak256(toBytes(json)),
    hosts: rows.map((r) => r.o.host),
    categories: rows.map((r) => r.info.category),
    severities: rows.map((r) => r.finding.severity),
  }
}
