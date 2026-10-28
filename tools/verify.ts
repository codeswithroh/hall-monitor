/**
 * Verify an evidence pack without trusting Hall Monitor.
 *   bun tools/verify.ts pack.json                          → re-derive the pack from its observations and check the hash
 *   bun tools/verify.ts pack.json --rpc $SEPOLIA_RPC --contract 0x…  → also confirm the hash was recorded onchain
 *
 * pack.json is either the pack JSON itself or a saved workflow log containing "EVIDENCE_PACK i/n …" chunks.
 */
import { createPublicClient, http, keccak256, toBytes } from "viem"
import { sepolia } from "viem/chains"
import { buildPack, type EvidencePack } from "../cre/audit/pack"
import { HallMonitorAbi } from "../cre/contracts/abi"

const [file, ...rest] = process.argv.slice(2)
if (!file) {
  console.error("usage: bun tools/verify.ts pack.json [--rpc URL --contract 0x…]")
  process.exit(2)
}
const flag = (name: string) => {
  const i = rest.indexOf(name)
  return i >= 0 ? rest[i + 1] : undefined
}

const text = await Bun.file(file).text()
const chunks = [...text.matchAll(/EVIDENCE_PACK (\d+)\/(\d+) (.*)$/gm)]
const raw = chunks.length
  ? chunks.sort((a, b) => Number(a[1]) - Number(b[1])).map((m) => m[3]).join("")
  : text.trim()
const pack = JSON.parse(raw) as EvidencePack
const hash = keccak256(toBytes(JSON.stringify(pack)))

// Re-run the published classification rules on the raw observations: the findings must follow from them.
const rebuilt = buildPack(
  pack.url,
  Math.floor(Date.parse(pack.observedAt) / 1000),
  pack.audience === "child-directed",
  pack.findings.map((f) => ({ host: f.host, via: f.via })),
)
const ok = (b: boolean) => (b ? "✓" : "✗")
console.log(`pack hash        ${hash}`)
console.log(`${ok(rebuilt.hash === hash)} findings follow from observations under the published COPPA rules`)

const rpc = flag("--rpc")
const contract = flag("--contract") as `0x${string}` | undefined
if (rpc && contract) {
  const client = createPublicClient({ chain: sepolia, transport: http(rpc) })
  const pageId = keccak256(toBytes(pack.url))
  const ids = await client.readContract({ address: contract, abi: HallMonitorAbi, functionName: "auditsFor", args: [pageId] })
  let found = false
  for (const id of ids) {
    const [, observedAt, evidenceHash] = await client.readContract({
      address: contract,
      abi: HallMonitorAbi,
      functionName: "audits",
      args: [id],
    })
    if (evidenceHash === hash) {
      found = true
      console.log(`✓ recorded onchain as audit #${id} at ${new Date(Number(observedAt) * 1000).toISOString()}`)
    }
  }
  if (!found) console.log(`✗ no onchain audit for ${pack.url} carries this hash`)
  for (const f of pack.findings) {
    const [t, active, persisted] = await client.readContract({
      address: contract,
      abi: HallMonitorAbi,
      functionName: "getTracker",
      args: [pageId, f.host],
    })
    const days = (Number(persisted) / 86400).toFixed(1)
    console.log(`  ${f.host.padEnd(34)} ${active ? "ACTIVE    " : "remediated"} seen ${t.observations}× over ${days} days`)
  }
  process.exit(found && rebuilt.hash === hash ? 0 : 1)
}
process.exit(rebuilt.hash === hash ? 0 : 1)
