# DoraHacks submission: Hall Monitor

## Logo
Upload `brand/logo-mark-1024.png`

## Name of your Build
Hall Monitor

## Brief description (tagline)
We turned children's privacy violations into court-ready evidence: independent Chainlink CRE nodes catch the trackers on kids' websites, map each one to COPPA, and seal the record on-chain so it can't be disputed or erased.

Shorter alternative:
We made COPPA violations provable: oracle nodes witness the trackers on kids' sites, and Ethereum keeps the record.

## Tags
LegalTech, RegTech, COPPA, Children's Privacy, Chainlink CRE, Ethereum, Evidence, AI x Blockchain

## Links
- GitHub Repo: https://github.com/codeswithroh/hall-monitor
- Website: https://hall-monitor.codeswithroh.workers.dev
- Video: (add your YouTube link)
- Other: https://hall-monitor.codeswithroh.workers.dev/app/  (live dashboard)
- Other: https://sepolia.etherscan.io/address/0x6f576CCa32A5f4337df8769E42a954d133167888  (HallMonitor contract)

## Bounty
Best workflow with CRE

---

## Description (paste into the editor)

### One screenshot isn't evidence. Five independent witnesses are.

Kids' websites routinely load ad pixels, session-replay scripts and fingerprinting tools before any parent has consented. Under COPPA (16 CFR Part 312), that's personal information collected from children without verifiable parental consent. The FTC's 2025 amendments add a separate consent requirement for sharing children's data with third parties, such as ad networks.

Proving it is the hard part. Today a violation rests on one investigator's crawl or screenshot. The defence can challenge how it was captured, whether it was altered, and how long the tracker was there. Duration matters, because civil penalties are assessed per violation.

**Hall Monitor turns that observation into evidence that holds up.**

### Try it live (2 minutes)
1. Open the **[dashboard](https://hall-monitor.codeswithroh.workers.dev/app/)** → **Run audit** → **Start audit**.
   It audits *KidQuest Games*, our fictional kids' site with real tracker scripts planted (fake IDs).
2. Watch the pipeline: **Fetch → Extract → Consensus → COPPA map → Seal on-chain**. The report lands on Ethereum Sepolia.
3. Switch off **Trackers planted** (the operator "fixes" the site) and run again. **Overview** now shows every tracker as *Remediated*, and the history stays on record.
4. Download the evidence pack and drop it into **Verify**. Your browser re-hashes it, re-runs the COPPA rules and finds the hash on-chain. You don't have to trust us.

### How it works
- **Observe.** In the Chainlink CRE workflow, every DON node fetches the child-directed page on its own and extracts the third-party hosts it loads (script, img, iframe and link tags, plus URLs inside inline loader snippets).
- **Agree.** Identical consensus keeps only the tracker set a Byzantine-fault-tolerant quorum of nodes saw. No single crawler decides what's in the record.
- **Map.** Deterministic rules, not an LLM, classify each tracker (advertising, session replay, fingerprinting, social, analytics, tag manager) and cite the 16 CFR Part 312 provisions it implicates. Every node reaches the same finding, and a lawyer can read the logic.
- **Seal.** The canonical evidence pack is hashed (keccak256) and written by a signed report to the `HallMonitor` contract.
- **Persist.** Scheduled re-audits update first-seen and last-seen for every tracker on every page. The chain itself shows how long a violation lasted and when it was remediated.

### Key features
- **Compliance dashboard.** Score gauge, exposure radar by tracker category, a ✕/✓ observation record of each tracker across each audit, severity mix, and an audit trail linked to Etherscan.
- **Tracker drawer.** Each tracker shows its rationale and the exact COPPA citations.
- **One-click exhibit export.** A printable record for counsel with findings, citations, evidence hashes and transaction IDs.
- **Trustless verification.** Check any evidence pack in the browser or with the CLI (`tools/verify.ts`) against the chain.
- **Remediation tracking.** Compliant operators get a verifiable record that trackers were removed and stayed removed.
- **Portfolio view.** Every monitored site with its score, issues and how long its longest violation has lasted.

### Who it's for
- **State AGs and the FTC:** independent observations, a timestamped duration, and a cited provision for every finding.
- **Plaintiff and defence counsel:** exhibits anyone can verify without trusting the tool.
- **Parents and advocates:** a plain answer to whether a kids' site tracks children.
- **Developers:** proof of compliance that can be verified.

### Tech stack
- **Chainlink CRE** (TypeScript SDK): cron-triggered workflow, HTTP capability with `consensusIdenticalAggregation`, signed reports through the KeystoneForwarder. Simulated and broadcast with the CRE CLI.
- **Solidity / Foundry:** `HallMonitor.sol`, a CRE receiver that stores per-page, per-tracker first-seen, last-seen and observation counts.
- **Ethereum Sepolia:** contract [`0x6f576CCa…7888`](https://sepolia.etherscan.io/address/0x6f576CCa32A5f4337df8769E42a954d133167888).
- **Cloudflare Workers + Durable Objects:** landing page, dashboard, hosted demo site and hosted audit runner.
- **viem, Bun, TypeScript:** shared extraction, COPPA and evidence-pack modules used by the workflow, the hosted runner, the CLI verifier and the in-browser verifier.

### Hackathon fit
- **Track:** LegalTech & RegTech, data privacy for minors, matching the youth focus of this edition.
- **Chainlink CRE bounty:** the oracle network's consensus does the legal work here. Independent observation is what turns a screenshot into evidence.

### Transparency
- The canonical path is the CRE workflow, run with `cre workflow simulate --broadcast`. For the public demo, a Cloudflare Worker runs the **same** extraction, COPPA and pack code with three independent fetches (two must agree), and submits through the same CRE mock forwarder. Every evidence pack records which method observed it.
- Extraction reads static HTML, so tags injected at runtime (for example by Google Tag Manager) aren't visible. That's why GTM itself is flagged for review. Next step: a headless-browser observer per node.
- Hall Monitor flags exposure for legal review. It doesn't make findings of liability.

### Links
- Live app: https://hall-monitor.codeswithroh.workers.dev
- Dashboard: https://hall-monitor.codeswithroh.workers.dev/app/
- Code: https://github.com/codeswithroh/hall-monitor
- Contract: https://sepolia.etherscan.io/address/0x6f576CCa32A5f4337df8769E42a954d133167888
