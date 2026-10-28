/**
 * Hall Monitor · COPPA audit workflow
 *
 * On each cron tick, every DON node fetches each child-directed target page on its own and extracts the
 * third-party hosts it loads. Identical-consensus keeps only a host set a Byzantine-fault-tolerant
 * quorum of nodes agreed on, so the record does not rest on one investigator's crawler. The workflow
 * classifies each host, maps it to COPPA provisions, hashes the evidence pack, and writes a signed
 * report to HallMonitor, which tracks first-seen / last-seen per tracker.
 */
import {
  CronCapability,
  EVMClient,
  HTTPClient,
  Runner,
  bytesToHex,
  consensusIdenticalAggregation,
  getNetwork,
  handler,
  hexToBase64,
  type HTTPSendRequester,
  type Runtime,
} from "@chainlink/cre-sdk"
import { encodeAbiParameters } from "viem"
import { AUDIT_REPORT } from "../contracts/abi"
import { extractThirdParties, type Observation } from "./extract"
import { buildPack } from "./pack"

type Target = { url: string; childDirected: boolean }

type Config = {
  schedule: string
  chainSelectorName: string
  hallMonitorAddress: string
  gasLimit: string
  targets: Target[]
}

/** One node's view of one page, serialized so identical-consensus compares exact bytes. */
const observe = (sendRequester: HTTPSendRequester, url: string): string => {
  try {
    const resp = sendRequester
      .sendRequest({ url, method: "GET", headers: { "User-Agent": "HallMonitor/0.1 (+children's-privacy audit)" } })
      .result()
    if (resp.statusCode < 200 || resp.statusCode >= 300) return `ERR:HTTP ${resp.statusCode}`
    const html = new TextDecoder().decode(resp.body)
    return JSON.stringify(extractThirdParties(html, url))
  } catch (e) {
    return `ERR:${String(e)}`
  }
}

const auditOne = (runtime: Runtime<Config>, evm: EVMClient, target: Target): string => {
  const agreed = new HTTPClient()
    .sendRequest(runtime, observe, consensusIdenticalAggregation<string>())(target.url)
    .result()
  if (agreed.startsWith("ERR:")) {
    runtime.log(`[${target.url}] nodes agreed the fetch failed: ${agreed.slice(4)}`)
    return "fetch-failed"
  }

  const observations = JSON.parse(agreed) as Observation[]
  const observedAt = Math.floor(runtime.now().getTime() / 1000)
  const built = buildPack(target.url, observedAt, target.childDirected, observations)
  const s = built.pack.summary
  runtime.log(`[${target.url}] ${s.thirdParties} third parties · ${s.high} high · ${s.medium} medium · ${s.review} review`)
  for (const f of built.pack.findings) runtime.log(`  ${f.severity.padEnd(6)} ${f.host} (${f.entity}, ${f.category})`)
  // The simulator truncates long log lines, so the pack goes out in numbered chunks (tools/verify.ts reassembles).
  const CHUNK = 600
  const parts = Math.ceil(built.json.length / CHUNK)
  for (let i = 0; i < parts; i++) {
    runtime.log(`EVIDENCE_PACK ${i + 1}/${parts} ${built.json.slice(i * CHUNK, (i + 1) * CHUNK)}`)
  }
  runtime.log(`evidence hash ${built.hash}`)

  const report = encodeAbiParameters(AUDIT_REPORT, [
    target.url,
    BigInt(observedAt),
    built.hash,
    built.hosts,
    built.categories,
    built.severities,
  ])
  const signed = runtime
    .report({ encodedPayload: hexToBase64(report), encoderName: "evm", signingAlgo: "ecdsa", hashingAlgo: "keccak256" })
    .result()
  const write = evm
    .writeReport(runtime, { receiver: runtime.config.hallMonitorAddress, report: signed, gasConfig: { gasLimit: runtime.config.gasLimit } })
    .result()
  const tx = bytesToHex(write.txHash || new Uint8Array(32))
  runtime.log(`[${target.url}] audit report → tx ${tx}`)
  return tx
}

const onTick = (runtime: Runtime<Config>): string => {
  const cfg = runtime.config
  const network = getNetwork({ chainFamily: "evm", chainSelectorName: cfg.chainSelectorName })
  if (!network) throw new Error(`unknown chain ${cfg.chainSelectorName}`)
  const evm = new EVMClient(network.chainSelector.selector)
  return cfg.targets.map((t) => auditOne(runtime, evm, t)).join(",")
}

const initWorkflow = (config: Config) => [handler(new CronCapability().trigger({ schedule: config.schedule }), onTick)]

export async function main() {
  const runner = await Runner.newRunner<Config>()
  await runner.run(initWorkflow)
}
