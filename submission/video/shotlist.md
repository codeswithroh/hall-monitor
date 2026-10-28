# Shot list: Hall Monitor

Layout: **pitch** (1920x1080).
rec shots: film them in film.mjs as shots/<name>/, log ev() times, then set each shot's "t"/"to" in project.json.
anim shots: write anims/<name>.html (window.seek(t), keyed to window.CUES), then node render_anim.mjs <name>.

- **rec `kidquest`** (3s+): KidQuest homepage, "Ages 6-12", slow scroll past the game cards
  covers: "It's built for six to twelve year olds."
- **rec `kidquest_source`** (5s+): view-source, highlight the Meta Pixel, TikTok and Hotjar snippets
  covers: "And it loads ad pixels and session recording on the very first page."
- **anim `screenshot`** (9s+): one lonely screenshot, then three question marks: captured how, edited, how long
  covers: "Today a case rests on one investigator's screenshot. The defence asks how it was captured, whether it was edited, and how long the tracker was really there."
- **rec `landing`** (1s+): landing page hero, then scroll to the five steps
  covers: "This is Hall Monitor."
- **anim `witnesses`** (10s+): one page, five oracle nodes each fetching it, a quorum lighting up the same six trackers
  covers: "Independent Chainlink nodes each load the page on their own. Only the trackers a quorum agrees on go on the record. One screenshot isn't evidence. Five witnesses are."
- **rec `audit`** (2s+): dashboard Run audit view, click Start audit, pipeline lights up stage by stage
  covers: "Let's audit it live. Fetch. Extract. Consensus."
- **rec `audit_result`** (5s+): result card appears, score 7, Critical, five high
  covers: "Six third parties. Five high severity. On a site for six year olds."
- **rec `etherscan`** (4s+): click the tx link, Etherscan transaction page
  covers: "And it's sealed on Ethereum, where nobody can quietly delete it."
- **rec `overview`** (3s+): Overview, slow pass over the gauge, live tracker pins and the exposure radar
  covers: "The case file shows everything at a glance."
- **rec `drawer`** (6s+): click the Hotjar row, drawer opens with the 16 CFR 312 citations
  covers: "Click any tracker and you get the reasoning and the exact provisions of 16 CFR Part 312."
- **rec `remediate`** (3s+): switch Trackers planted off, Start audit, result 100 Compliant
  covers: "Now the site fixes itself. We audit again. Clean."
- **rec `remediated`** (9s+): Overview, every tracker Remediated, the plus 93 delta, the observation grid
  covers: "But the history stays. The chain shows when each tracker was first seen, last seen and removed. Penalties are per violation, so duration is the evidence."
- **rec `verify`** (6s+): download the evidence pack, drop it into Verify, three green checks appear
  covers: "And anyone can check our work. Drop in the evidence pack. Three green checks, without trusting us."
- **anim `pipeline`** (9s+): Observe, Agree, Map, Seal, Persist, as five connected stages with the CRE report landing in the HallMonitor contract
  covers: "Under the hood it's a Chainlink CRE workflow. Each node fetches, consensus keeps what a quorum saw, and a signed report lands in our contract."
- **rec `terminal`** (5s+): cre workflow simulate running, findings and the evidence hash scrolling by
  covers: "The live demo runs that same code, so you can try it yourself."
