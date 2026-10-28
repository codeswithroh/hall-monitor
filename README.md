<img src="brand/logo-lockup.png" alt="Hall Monitor" width="420">

# Hall Monitor

Children's-privacy (COPPA) audits that hold up as evidence. A Chainlink CRE workflow has every node in
a decentralized oracle network fetch a child-directed page on its own and pull out the third-party
trackers it loads. Only the tracker set a fault-tolerant quorum agrees on is recorded. Each tracker is
mapped to COPPA provisions, the evidence pack is hashed, and a DON-signed report goes onchain.
Re-audits on a schedule build a first-seen / last-seen history, so the chain shows how long a violation
lasted and whether it was fixed.

> One investigator's screenshot can be challenged. Five independent nodes seeing the same thing at the same time is much harder to challenge.

**Live:** [landing](https://hall-monitor.codeswithroh.workers.dev) · [dashboard](https://hall-monitor.codeswithroh.workers.dev/app/), reading the
[HallMonitor contract](https://sepolia.etherscan.io/address/0x6f576CCa32A5f4337df8769E42a954d133167888) on Ethereum Sepolia.

**Try it live:** open the dashboard → **Run audit** → **Start audit**. It audits the hosted
[KidQuest demo site](https://hall-monitor.codeswithroh.workers.dev/kidquest/) and seals the result on Sepolia.
Switch off **Trackers planted**, run again, and the Overview shows every tracker remediated. Drop the
downloaded evidence pack into **Verify** to check it against the chain.

Built for the [BLI Legal Tech Hackathon 2](https://dorahacks.io/hackathon/legal-hack-2026) (LegalTech & RegTech track:
data privacy for minors) and the Chainlink CRE bounty.

## Why it matters

The FTC's amended COPPA Rule requires verifiable parental consent before a child-directed service collects
personal information, including the persistent identifiers that ad pixels and session-replay scripts set.
The 2025 amendments add a separate consent for disclosing that data to third parties. Proving a violation
usually means one investigator's crawl, which is easy to dispute and says nothing about how long the
violation lasted. Hall Monitor replaces that with:

- **Independent observation.** Each DON node fetches the page itself, and identical-consensus keeps only what a quorum saw.
- **Reproducible findings.** The COPPA mapping is plain rules, not an LLM, so anyone can re-derive every severity and citation from the observations.
- **Tamper evidence.** The keccak256 of the evidence pack is signed by the DON and stored onchain.
- **Duration and remediation.** The contract tracks first-seen and last-seen per tracker, so the chain itself shows how long a tracker stayed and when it was removed.

## How it works

```
cron ─► each DON node: GET page ─► extract third-party hosts ─► identical consensus
     ─► classify (trackers.ts) ─► COPPA rules (coppa.ts) ─► evidence pack + keccak256 (pack.ts)
     ─► signed report ─► HallMonitor.onReport ─► per-tracker firstSeen / lastSeen / active
```

```
demo-site/      KidQuest Games: fictional kids' site with planted trackers (fake IDs) and a remediate toggle
cre/audit/      CRE workflow (TypeScript)
  main.ts         cron trigger → per-node fetch → identical consensus → classify → signed report
  extract.ts      static HTML → third-party hosts (deterministic, WASM-safe)
  trackers.ts     tracker host → entity + category
  coppa.ts        category → severity + 16 CFR Part 312 provisions
  pack.ts         canonical evidence pack + keccak256 (shared with the verifier and the frontend)
contracts/      HallMonitor.sol: CRE receiver with per-page, per-tracker persistence (Foundry)
web/            Landing page (/) and dashboard (/app): compliance gauge, exposure radar, observation
                record, audit trail, tracker drawer with COPPA citations, printable exhibit, site
                portfolio, live audit pipeline, in-browser exhibit verifier
brand/          Logo mark and lockups (SVG + PNG)
tools/verify.ts CLI verifier: re-hash a pack, re-derive its findings, confirm it onchain
evidence/       Packs and logs from the live Sepolia audits
```

## Two ways audits run

| | Where | How it observes | How it's sealed |
|---|---|---|---|
| **CRE workflow** (canonical) | `cre workflow simulate` locally, or a deployed DON | each DON node fetches the page; identical consensus | DON-signed report → KeystoneForwarder → `HallMonitor.onReport` |
| **Hosted runner** (live demo) | Cloudflare Worker + Durable Object (`web/src/worker.ts`) | 3 independent fetches; 2 must agree | same report encoding → CRE MockKeystoneForwarder on Sepolia → `HallMonitor.onReport` |

Both run the same `extract.ts`, `coppa.ts` and `pack.ts`, and each evidence pack records its own method,
so a pack says how it was observed. The hosted runner serializes audits so the signing wallet's nonces
never collide, refuses private addresses, and rate-limits on-chain writes (one every 12 s, 12 per IP per hour).

## Quick start

Needs [Bun](https://bun.sh), [Foundry](https://getfoundry.sh) and the [CRE CLI](https://docs.chain.link/cre).

```bash
git clone --recurse-submodules https://github.com/codeswithroh/hall-monitor && cd hall-monitor
bun install && (cd cre/audit && bun install)
bun run test                      # workflow unit tests + forge tests
bun run dev                       # KidQuest on :8787, landing + dashboard on :5173 (/app)
```

The dashboard's **Run audit** view calls `cre workflow simulate` through the local server and streams
the output. Running it needs `cre login` and a funded Sepolia testnet key in `cre/.env`:

```bash
cp cre/.env.example cre/.env      # CRE_ETH_PRIVATE_KEY, SEPOLIA_RPC
```

### From the terminal

```bash
cd cre
cre workflow simulate audit --target staging-settings --non-interactive --trigger-index 0 [--broadcast]
```

The log prints each finding, the evidence hash and the pack as numbered `EVIDENCE_PACK i/n` chunks,
because the simulator truncates long lines. Save the log and run `bun run verify that.log`.

### Demo the remediation story

1. Run an audit with trackers on: 6 third parties, 5 high, all **Active**.
2. Switch off **Trackers planted** on the KidQuest card, or `curl -X POST localhost:8787/__remediate`.
3. Run again: 0 found. The Overview shows every tracker **Remediated**, with its history kept.
4. Switch the trackers back on and run again: they return as **Active**, and their persistence span grows.

## Live deployment (Ethereum Sepolia)

| | |
|---|---|
| HallMonitor | [`0x6f576CCa32A5f4337df8769E42a954d133167888`](https://sepolia.etherscan.io/address/0x6f576CCa32A5f4337df8769E42a954d133167888) |
| Audit #0: trackers on, 6 found, 5 high | [`0x85406bf7…8077`](https://sepolia.etherscan.io/tx/0x85406bf7d99dfaf1cd8880c64c4c0574d59f4f13fbaecd9212465742cf618077), pack [`evidence/audit1.pack.json`](evidence/audit1.pack.json) |
| Audit #1: remediated, 0 found | [`0x2b8dbd62…0f01`](https://sepolia.etherscan.io/tx/0x2b8dbd62ff8e51282cbc1de60dfef6501c21ae13d412bc75587fc8b484120f01), log [`evidence/audit2.log`](evidence/audit2.log) |
| Audit #2: trackers back, 6 found, 5 high | [`0xaa61a6c7…e22f`](https://sepolia.etherscan.io/tx/0xaa61a6c7546b1d9e6d39a8410fc95ddac4bb1e2def02159afd7fdb9253afe22f) |
| Audit #3: still present ~8 hours later | see the [dashboard](https://hall-monitor.codeswithroh.workers.dev/app/) audit trail |

```bash
bun run verify evidence/audit1.pack.json --rpc https://ethereum-sepolia-rpc.publicnode.com \
  --contract 0x6f576CCa32A5f4337df8769E42a954d133167888
```

### Deploying your own

1. Deploy the contract with the Sepolia mock forwarder `0x15fC6ae953E024d975e77382eEeC56A9101f9F88`
   (a deployed DON uses `0xF8344CFd5c43616a4366C34E3EEE75af79a74482`; both come from `cre workflow supported-chains`).
   Sepolia charges about 10M gas for this create, roughly 7× Foundry's local estimate, so pass an explicit limit:
   ```bash
   cd contracts
   forge create src/HallMonitor.sol:HallMonitor --rpc-url $SEPOLIA_RPC --private-key 0x$CRE_ETH_PRIVATE_KEY \
     --broadcast --gas-limit 12000000 --constructor-args 0x15fC6ae953E024d975e77382eEeC56A9101f9F88
   ```
2. Set `hallMonitorAddress` in `cre/audit/config.staging.json`, and `HALL_MONITOR` / `DEPLOY_BLOCK` in `web/src/config.ts`.
3. Deploy the site and hosted runner to Cloudflare: `wrangler secret put CRE_ETH_PRIVATE_KEY` (in `web/`, a funded
   testnet key), then `bun run deploy`. Config lives in `web/wrangler.jsonc`.

A DON-deployed workflow can't reach `localhost`. Host `demo-site/` publicly and update `targets`.

## Limits

- **Static HTML only.** Tags injected at runtime, for example by Google Tag Manager, are invisible to the
  extractor. GTM itself is flagged "Review" for this reason. Next step: a headless-browser observer per node.
- **Child-directed status is declared per target, not inferred.** Whether a site is directed to children
  is a multi-factor legal test under 16 CFR 312.2.
- **Flags exposure for legal review; it doesn't conclude liability.** Check the cited provisions against
  the current eCFR text.
- **Hostname matching is approximate.** Registrable domain is taken as the last two labels, which is wrong
  for suffixes like `.co.uk`.

## License

MIT
