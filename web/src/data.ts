/**
 * Everything the UI shows is derived from two contract events, so one pass of getLogs is enough:
 * AuditRecorded (one per audit) and TrackerObserved (one per tracker per audit, same tx).
 */
import { createPublicClient, http, keccak256, parseAbiItem, toBytes, type Hex } from "viem"
import { sepolia } from "viem/chains"
import { Severity } from "../../cre/audit/coppa"
import { Category, lookupTracker } from "../../cre/audit/trackers"
import { CHAIN, DEPLOY_BLOCK, HALL_MONITOR } from "./config"

export const client = createPublicClient({ chain: sepolia, transport: http(CHAIN.rpc) })

const AUDIT_EVENT = parseAbiItem(
  "event AuditRecorded(uint256 indexed auditId, bytes32 indexed pageId, string url, uint64 observedAt, bytes32 evidenceHash, uint16 trackerCount, uint16 highCount)",
)
const TRACKER_EVENT = parseAbiItem(
  "event TrackerObserved(bytes32 indexed pageId, string host, uint8 category, uint8 severity, uint64 firstSeen, uint64 lastSeen)",
)

export type Audit = {
  id: number
  pageId: Hex
  url: string
  at: number
  evidenceHash: Hex
  trackerCount: number
  highCount: number
  tx: Hex
  hosts: Set<string>
}

export type Tracker = {
  host: string
  entity: string
  category: Category
  severity: Severity
  firstSeen: number
  lastSeen: number
  observations: number
  active: boolean
}

export type Site = {
  url: string
  pageId: Hex
  audits: Audit[]
  trackers: Tracker[]
  score: number
  activeBySeverity: Record<"high" | "medium" | "review", number>
  exposure: Record<number, number>
  longest: number
}

export const pageIdOf = (url: string): Hex => keccak256(toBytes(url))

/** 100 minus weighted active findings. A rough triage signal, not a legal measure. */
export const scoreOf = (t: Tracker[]) =>
  Math.max(
    0,
    100 -
      t
        .filter((x) => x.active)
        .reduce((s, x) => s + (x.severity === Severity.High ? 18 : x.severity === Severity.Medium ? 9 : x.severity === Severity.Review ? 3 : 0), 0),
  )

export const grade = (score: number) =>
  score >= 90 ? { label: "Compliant", tone: "green" } : score >= 60 ? { label: "At risk", tone: "amber" } : { label: "Critical", tone: "red" }

const getLogsChunked = async <E extends typeof AUDIT_EVENT | typeof TRACKER_EVENT>(event: E, latest: bigint) => {
  const STEP = 40_000n
  const out = []
  for (let from = DEPLOY_BLOCK; from <= latest; from += STEP) {
    const to = from + STEP - 1n > latest ? latest : from + STEP - 1n
    out.push(...(await client.getLogs({ address: HALL_MONITOR, event, fromBlock: from, toBlock: to })))
  }
  return out
}

export const loadSites = async (): Promise<{ sites: Site[]; audits: Audit[] }> => {
  const latest = await client.getBlockNumber()
  const [auditLogs, trackerLogs] = await Promise.all([getLogsChunked(AUDIT_EVENT, latest), getLogsChunked(TRACKER_EVENT, latest)])

  const byTx = new Map<string, Audit>()
  const audits: Audit[] = auditLogs.map((l) => {
    const a = l.args as { auditId: bigint; pageId: Hex; url: string; observedAt: bigint; evidenceHash: Hex; trackerCount: number; highCount: number }
    const row: Audit = {
      id: Number(a.auditId),
      pageId: a.pageId,
      url: a.url,
      at: Number(a.observedAt),
      evidenceHash: a.evidenceHash,
      trackerCount: a.trackerCount,
      highCount: a.highCount,
      tx: l.transactionHash!,
      hosts: new Set(),
    }
    byTx.set(l.transactionHash!, row)
    return row
  })
  audits.sort((a, b) => a.id - b.id)

  const trackerState = new Map<string, Map<string, Tracker>>() // pageId → host → tracker
  for (const l of trackerLogs) {
    const a = l.args as { pageId: Hex; host: string; category: number; severity: number; firstSeen: bigint; lastSeen: bigint }
    byTx.get(l.transactionHash!)?.hosts.add(a.host)
    const page = trackerState.get(a.pageId) ?? new Map<string, Tracker>()
    trackerState.set(a.pageId, page)
    const prev = page.get(a.host)
    page.set(a.host, {
      host: a.host,
      entity: lookupTracker(a.host)?.entity ?? "Unknown",
      category: a.category as Category,
      severity: a.severity as Severity,
      firstSeen: Number(a.firstSeen),
      lastSeen: Math.max(prev?.lastSeen ?? 0, Number(a.lastSeen)),
      observations: (prev?.observations ?? 0) + 1,
      active: false,
    })
  }

  const byUrl = new Map<string, Audit[]>()
  for (const a of audits) byUrl.set(a.url, [...(byUrl.get(a.url) ?? []), a])

  const sites: Site[] = [...byUrl.entries()].map(([url, list]) => {
    const pageId = list[0].pageId
    const last = list[list.length - 1]
    const trackers = [...(trackerState.get(pageId)?.values() ?? [])].map((t) => ({ ...t, active: last.hosts.has(t.host) }))
    trackers.sort((a, b) => Number(b.active) - Number(a.active) || b.severity - a.severity || a.host.localeCompare(b.host))
    const active = trackers.filter((t) => t.active)
    const exposure: Record<number, number> = {}
    for (const t of active) exposure[t.category] = (exposure[t.category] ?? 0) + 1
    return {
      url,
      pageId,
      audits: list,
      trackers,
      score: scoreOf(trackers),
      activeBySeverity: {
        high: active.filter((t) => t.severity === Severity.High).length,
        medium: active.filter((t) => t.severity === Severity.Medium).length,
        review: active.filter((t) => t.severity === Severity.Review).length,
      },
      exposure,
      longest: trackers.reduce((m, t) => Math.max(m, t.lastSeen - t.firstSeen), 0),
    }
  })
  sites.sort((a, b) => b.audits[b.audits.length - 1].at - a.audits[a.audits.length - 1].at)
  return { sites, audits }
}
