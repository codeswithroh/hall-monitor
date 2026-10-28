/**
 * Hosted audit runner. Runs the same modules as the CRE workflow (extract → COPPA rules → evidence
 * pack → AUDIT_REPORT encoding) and submits the report through the CRE MockKeystoneForwarder on
 * Sepolia, the same contract path `cre workflow simulate --broadcast` uses. Runtime-agnostic: plain
 * fetch + viem, so it runs in a Cloudflare Worker and in Bun.
 */
import {
  bytesToHex,
  concatHex,
  createPublicClient,
  createWalletClient,
  encodeAbiParameters,
  encodeFunctionData,
  http,
  keccak256,
  padHex,
  parseAbi,
  stringToHex,
  toHex,
  type Hex,
} from "viem"
import { privateKeyToAccount } from "viem/accounts"
import { sepolia } from "viem/chains"
import { extractThirdParties, type Observation } from "../../cre/audit/extract"
import { buildPack, HOSTED_METHOD, type BuiltPack } from "../../cre/audit/pack"
import { AUDIT_REPORT } from "../../cre/contracts/abi"

export type RunnerEnv = {
  rpc: string
  hallMonitor: Hex
  forwarder: Hex
  privateKey?: string
}

export type Emit = (event: "line" | "done", data: string) => void

const FORWARDER_ABI = parseAbi(["function report(address receiver, bytes rawReport, bytes reportContext, bytes[] signatures)"])
const OBSERVERS = 3
const QUORUM = 2
const MAX_HTML = 1_500_000

/** Keystone report header: version | executionId | timestamp | donId | donConfigVersion | workflowId | workflowName | owner | reportId. */
const header = (owner: Hex, observedAt: number, body: Hex): Hex =>
  concatHex([
    "0x01",
    keccak256(concatHex([body, toHex(observedAt, { size: 8 })])),
    toHex(observedAt, { size: 4 }),
    toHex(0, { size: 4 }),
    toHex(1, { size: 4 }),
    keccak256(stringToHex("hall-monitor/hosted-runner@1")),
    padHex(stringToHex("hallmon-ht"), { size: 10, dir: "right" }),
    owner,
    "0x0001",
  ])

export type Fetcher = (url: string) => Promise<string>

export const defaultFetcher: Fetcher = async (url) => {
  const res = await fetch(url, {
    headers: { "User-Agent": "HallMonitor/0.1 (+children's-privacy audit)", Accept: "text/html,*/*" },
    redirect: "follow",
    signal: AbortSignal.timeout(10_000),
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const text = await res.text()
  return text.length > MAX_HTML ? text.slice(0, MAX_HTML) : text
}

/** OBSERVERS independent fetches; a host set at least QUORUM of them produced byte-identically wins. */
export const observe = async (url: string, fetcher: Fetcher, emit: Emit): Promise<Observation[]> => {
  const views = await Promise.all(
    Array.from({ length: OBSERVERS }, async (_, i) => {
      try {
        const html = await fetcher(url)
        const obs = extractThirdParties(html, url)
        emit("line", `· observer ${i + 1}: ${obs.length} third-party host(s)`)
        return JSON.stringify(obs)
      } catch (e) {
        emit("line", `· observer ${i + 1}: fetch failed (${String((e as Error).message ?? e)})`)
        return `ERR`
      }
    }),
  )
  const tally = new Map<string, number>()
  for (const v of views) if (v !== "ERR") tally.set(v, (tally.get(v) ?? 0) + 1)
  const [winner, votes] = [...tally.entries()].sort((a, b) => b[1] - a[1])[0] ?? ["", 0]
  if (votes < QUORUM) throw new Error(views.every((v) => v === "ERR") ? "Every observer failed to fetch the page" : "Observers disagreed: page content changes between loads")
  emit("line", `· consensus: ${votes}/${OBSERVERS} observers agreed`)
  return JSON.parse(winner) as Observation[]
}

export const runAudit = async (
  opts: { url: string; childDirected: boolean; broadcast: boolean },
  env: RunnerEnv,
  emit: Emit,
  fetcher: Fetcher = defaultFetcher,
) => {
  emit("line", "Hosted runner · same extract/COPPA/pack modules as the CRE workflow")
  emit("line", `· Running trigger: audit ${opts.url}`)
  const observations = await observe(opts.url, fetcher, emit)

  const observedAt = Math.floor(Date.now() / 1000)
  const built: BuiltPack = buildPack(opts.url, observedAt, opts.childDirected, observations, HOSTED_METHOD)
  const s = built.pack.summary
  emit("line", `[${opts.url}] ${s.thirdParties} third parties · ${s.high} high · ${s.medium} medium · ${s.review} review`)
  for (const f of built.pack.findings) emit("line", `${f.severity.padEnd(6)} ${f.host} (${f.entity}, ${f.category})`)
  emit("line", `evidence hash ${built.hash}`)

  let tx: Hex | undefined
  if (opts.broadcast) {
    if (!env.privateKey) throw new Error("Runner has no signing key configured")
    const account = privateKeyToAccount(`0x${env.privateKey.replace(/^0x/, "")}`)
    const body = encodeAbiParameters(AUDIT_REPORT, [opts.url, BigInt(observedAt), built.hash, built.hosts, built.categories, built.severities])
    const data = encodeFunctionData({
      abi: FORWARDER_ABI,
      functionName: "report",
      args: [env.hallMonitor, concatHex([header(account.address, observedAt, body), body]), bytesToHex(new Uint8Array(96)), []],
    })
    const pub = createPublicClient({ chain: sepolia, transport: http(env.rpc) })
    const wallet = createWalletClient({ account, chain: sepolia, transport: http(env.rpc) })
    const gas = await pub.estimateGas({ account, to: env.forwarder, data })
    emit("line", `· sealing report via CRE mock forwarder (gas ≈ ${gas})`)
    tx = await wallet.sendTransaction({ to: env.forwarder, data, gas: (gas * 13n) / 10n })
    const receipt = await pub.waitForTransactionReceipt({ hash: tx, timeout: 90_000, pollingInterval: 3_000 })
    if (receipt.status !== "success") throw new Error(`Report transaction reverted (${tx})`)
    emit("line", `[${opts.url}] audit report → tx ${tx}`)
  } else {
    emit("line", "· dry run: report not written on-chain")
  }
  emit("done", JSON.stringify({ hash: built.hash, tx, packJson: built.json, pack: built.pack }))
}

/** Dry-run the forwarder call without sending, to check the mock forwarder accepts the encoding. */
export const simulateReport = async (url: string, env: RunnerEnv, observations: Observation[] = []) => {
  const account = privateKeyToAccount(`0x${env.privateKey!.replace(/^0x/, "")}`)
  const observedAt = Math.floor(Date.now() / 1000)
  const built = buildPack(url, observedAt, true, observations)
  const body = encodeAbiParameters(AUDIT_REPORT, [url, BigInt(observedAt), built.hash, built.hosts, built.categories, built.severities])
  const data = encodeFunctionData({
    abi: FORWARDER_ABI,
    functionName: "report",
    args: [env.hallMonitor, concatHex([header(account.address, observedAt, body), body]), bytesToHex(new Uint8Array(96)), []],
  })
  const pub = createPublicClient({ chain: sepolia, transport: http(env.rpc) })
  await pub.call({ account, to: env.forwarder, data })
  return pub.estimateGas({ account, to: env.forwarder, data })
}
