---
title: Hall Monitor
layout: pitch
accent: "#3EE07F"
url: https://hall-monitor.codeswithroh.workers.dev
end_title: Hall Monitor
end_tagline: One screenshot isn't evidence. <b>Five witnesses are.</b>
end_links: hall-monitor.codeswithroh.workers.dev, github.com/codeswithroh/hall-monitor
---
## Hook
[face]
This kids' game sends your child's data to **Meta, TikTok and Google** before any parent says yes.
[rec kidquest: KidQuest homepage, "Ages 6-12", slow scroll past the game cards]
It's built for six to twelve year olds.
[rec kidquest_source: view-source, highlight the Meta Pixel, TikTok and Hotjar snippets]
And it loads ad pixels and session recording on the very first page.

## The problem
[face]
Under COPPA, that needs **verifiable parental consent**.
[card coppa]
And since the FTC's 2025 update, sharing kids' data with ad networks needs a separate yes.
[face]
But proving it is the hard part.
[anim screenshot: one lonely screenshot, then three question marks: captured how, edited, how long]
Today a case rests on one investigator's screenshot. The defence asks how it was captured, whether it was edited, and how long the tracker was really there.
[title UNTIL NOW.]
Until now.

## Meet Hall Monitor
[rec landing: landing page hero, then scroll to the five steps]
This is Hall Monitor.
[anim witnesses: one page, five oracle nodes each fetching it, a quorum lighting up the same six trackers]
Independent Chainlink nodes each load the page on their own. Only the trackers a quorum agrees on go on the record. One screenshot isn't evidence. **Five witnesses are.**

## Live audit
[rec audit: dashboard Run audit view, click Start audit, pipeline lights up stage by stage]
Let's audit it live. Fetch. Extract. Consensus.
[rec audit_result: result card appears, score 7, Critical, five high]
Six third parties. **Five high severity.** On a site for six year olds.
[rec etherscan: click the tx link, Etherscan transaction page]
And it's sealed on Ethereum, where nobody can quietly delete it.

## The case file
[rec overview: Overview, slow pass over the gauge, live tracker pins and the exposure radar]
The case file shows everything at a glance.
[rec drawer: click the Hotjar row, drawer opens with the 16 CFR 312 citations]
Click any tracker and you get the reasoning and the exact provisions of 16 CFR Part 312.
[zoom tr]
It's plain rules, not an AI guess, so every node reaches the same finding and a lawyer can check the logic.

## Proof
[rec remediate: switch Trackers planted off, Start audit, result 100 Compliant]
Now the site fixes itself. We audit again. **Clean.**
[rec remediated: Overview, every tracker Remediated, the plus 93 delta, the observation grid]
But the history stays. The chain shows when each tracker was first seen, last seen and removed. Penalties are per violation, so **duration** is the evidence.
[rec verify: download the evidence pack, drop it into Verify, three green checks appear]
And anyone can check our work. Drop in the evidence pack. Three green checks, without trusting us.

## How it works
[anim pipeline: Observe, Agree, Map, Seal, Persist, as five connected stages with the CRE report landing in the HallMonitor contract]
Under the hood it's a Chainlink CRE workflow. Each node fetches, consensus keeps what a quorum saw, and a signed report lands in our contract.
[rec terminal: cre workflow simulate running, findings and the evidence hash scrolling by]
The live demo runs that same code, so you can try it yourself.

## Outro
[face]
Kids can't read a privacy policy. Hall Monitor reads the page for them.
[end]
Run an audit at hall-monitor dot codeswithroh dot workers dot dev.
