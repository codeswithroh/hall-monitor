import { createPublicClient, http, keccak256, parseAbiItem, toBytes, type Hex } from "viem"
import { sepolia } from "viem/chains"
import { HallMonitorAbi } from "../../cre/contracts/abi"
import { CHAIN, DEPLOY_BLOCK, HALL_MONITOR } from "./config"

export const client = createPublicClient({ chain: sepolia, transport: http(CHAIN.rpc) })

const AUDIT_EVENT = parseAbiItem(
  "event AuditRecorded(uint256 indexed auditId, bytes32 indexed pageId, string url, uint64 observedAt, bytes32 evidenceHash, uint16 trackerCount, uint16 highCount)",
)

export type AuditRow = {
  auditId: bigint
  pageId: Hex
  url: string
  observedAt: number
  evidenceHash: Hex
  trackerCount: number
  highCount: number
  tx: Hex
}

export type TrackerRow = {
  host: string
  firstSeen: number
  lastSeen: number
  observations: number
  category: number
  severity: number
  active: boolean
  persistedSeconds: number
}

/** All audits, oldest first. Chunked so public RPCs with block-range caps still answer. */
export const loadAudits = async (): Promise<AuditRow[]> => {
  const latest = await client.getBlockNumber()
  const STEP = 40_000n
  const rows: AuditRow[] = []
  for (let from = DEPLOY_BLOCK; from <= latest; from += STEP) {
    const to = from + STEP - 1n > latest ? latest : from + STEP - 1n
    const logs = await client.getLogs({ address: HALL_MONITOR, event: AUDIT_EVENT, fromBlock: from, toBlock: to })
    for (const l of logs) {
      const a = l.args
      rows.push({
        auditId: a.auditId!,
        pageId: a.pageId!,
        url: a.url!,
        observedAt: Number(a.observedAt!),
        evidenceHash: a.evidenceHash!,
        trackerCount: a.trackerCount!,
        highCount: a.highCount!,
        tx: l.transactionHash!,
      })
    }
  }
  return rows.sort((a, b) => Number(a.auditId - b.auditId))
}

export const pageIdOf = (url: string): Hex => keccak256(toBytes(url))

export const loadTrackers = async (pageId: Hex): Promise<TrackerRow[]> => {
  const [, , , , hosts] = await client.readContract({
    address: HALL_MONITOR,
    abi: HallMonitorAbi,
    functionName: "getPage",
    args: [pageId],
  })
  return Promise.all(
    hosts.map(async (host) => {
      const [t, active, persisted] = await client.readContract({
        address: HALL_MONITOR,
        abi: HallMonitorAbi,
        functionName: "getTracker",
        args: [pageId, host],
      })
      return {
        host,
        firstSeen: Number(t.firstSeen),
        lastSeen: Number(t.lastSeen),
        observations: t.observations,
        category: t.category,
        severity: t.severity,
        active,
        persistedSeconds: Number(persisted),
      }
    }),
  )
}
