import { keccak256, toBytes } from "viem"
import { HallMonitorAbi } from "../../cre/contracts/abi"
import { assess, Severity } from "../../cre/audit/coppa"
import { buildPack, type EvidencePack } from "../../cre/audit/pack"
import { Category } from "../../cre/audit/trackers"
import { gauge, icon, radar, ring, tickDial } from "./charts"
import { CHAIN, DEMO_URL, GITHUB, HALL_MONITOR } from "./config"
import { client, grade, loadSites, pageIdOf, scoreOf, type Audit, type Site, type Tracker } from "./data"

// ------------------------------------------------------------------ helpers

const $ = <T extends HTMLElement = HTMLElement>(sel: string, root: ParentNode = document) => root.querySelector(sel) as T
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)
const short = (h: string, n = 6) => `${h.slice(0, n + 2)}…${h.slice(-4)}`
const day = (s: number) => new Date(s * 1000).toLocaleDateString(undefined, { day: "numeric", month: "short" })
const time = (s: number) => new Date(s * 1000).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })
const full = (s: number) => new Date(s * 1000).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })
const ago = (s: number) => {
  const d = Math.max(0, Date.now() / 1000 - s)
  return d < 60 ? "just now" : d < 3600 ? `${Math.floor(d / 60)}m ago` : d < 86400 ? `${Math.floor(d / 3600)}h ago` : `${Math.floor(d / 86400)}d ago`
}
const span = (s: number) => {
  if (s < 60) return "—"
  const d = Math.floor(s / 86400)
  const h = Math.floor((s % 86400) / 3600)
  const m = Math.floor((s % 3600) / 60)
  return d ? `${d}d ${h}h` : h ? `${h}h ${m}m` : `${m}m`
}
const hostOfUrl = (u: string) => u.replace(/^https?:\/\//, "").replace(/\/.*$/, "")
const txUrl = (tx: string) => `${CHAIN.explorer}/tx/${tx}`

const SEV = ["None", "Review", "Medium", "High"] as const
const SEV_TONE = ["muted", "amber", "amber", "red"] as const
const CATS: Array<[Category, string]> = [
  [Category.Advertising, "Advertising"],
  [Category.SessionReplay, "Session replay"],
  [Category.Fingerprinting, "Fingerprinting"],
  [Category.Social, "Social"],
  [Category.Analytics, "Analytics"],
  [Category.TagManager, "Tag manager"],
]
const catName = (c: number) => CATS.find(([k]) => k === c)?.[1] ?? "Unknown"
const pill = (text: string, tone: string) => `<span class="pill tone-${tone}">${esc(text)}</span>`
/** Initial badge. Pass an entity name ("Meta Pixel") or a hostname ("kids.example.com"). */
const avatar = (label: string, tone: string) => {
  const parts = label.split(".")
  const name = parts.length > 2 ? parts[parts.length - 2] : parts[0]
  return `<span class="av tone-${tone}">${esc((name.match(/[a-z0-9]/i)?.[0] ?? "?").toUpperCase())}</span>`
}

const toast = (msg: string) => {
  const t = document.createElement("div")
  t.className = "toast"
  t.textContent = msg
  document.body.append(t)
  requestAnimationFrame(() => t.classList.add("in"))
  setTimeout(() => {
    t.classList.remove("in")
    setTimeout(() => t.remove(), 300)
  }, 1800)
}

// ------------------------------------------------------------------ state + router

let sites: Site[] = []
let audits: Audit[] = []
let local = false
let loaded = false
let loadError = ""

type Route = { name: "overview"; url?: string } | { name: "sites" } | { name: "audit"; url?: string } | { name: "verify" }

const parseRoute = (): Route => {
  const h = location.hash.replace(/^#\/?/, "")
  const [name, ...rest] = h.split("/")
  const arg = rest.length ? decodeURIComponent(rest.join("/")) : undefined
  if (name === "sites") return { name: "sites" }
  if (name === "audit") return { name: "audit", url: arg }
  if (name === "verify") return { name: "verify" }
  if (name === "site") return { name: "overview", url: arg }
  return { name: "overview" }
}
const siteHref = (url: string) => `#/site/${encodeURIComponent(url)}`

const render = () => {
  const route = parseRoute()
  document.querySelectorAll<HTMLAnchorElement>(".nav a").forEach((a) =>
    a.classList.toggle("is-active", a.dataset.route === route.name),
  )
  const view = $("#view")
  view.classList.remove("fade")
  void view.offsetWidth
  view.classList.add("fade")
  if (!loaded) {
    view.innerHTML = skeleton()
    return
  }
  if (route.name === "sites") view.innerHTML = sitesView()
  else if (route.name === "audit") view.innerHTML = auditView(route.url)
  else if (route.name === "verify") view.innerHTML = verifyView()
  else view.innerHTML = overview(route.url)
  wire(route)
  window.scrollTo({ top: 0 })
}

const skeleton = () =>
  `<div class="grid">${[4, 8, 4, 8, 12].map((s) => `<div class="card sk span-${s}"><div class="sk-bar"></div><div class="sk-block"></div></div>`).join("")}</div>`

// ------------------------------------------------------------------ overview

const activeAt = (site: Site, audit: Audit): Tracker[] =>
  site.trackers.filter((t) => audit.hosts.has(t.host)).map((t) => ({ ...t, active: true }))

const overview = (url?: string) => {
  if (loadError) return emptyState("Couldn't reach the chain", loadError)
  if (!sites.length) return emptyState("No audits yet", "Run the first audit to open a case.", true)
  const site = sites.find((s) => s.url === url) ?? sites[0]
  const last = site.audits[site.audits.length - 1]
  const prev = site.audits[site.audits.length - 2]
  const g = grade(site.score)
  const delta = prev ? site.score - scoreOf(activeAt(site, prev)) : 0
  const active = site.trackers.filter((t) => t.active)
  const remediated = site.trackers.filter((t) => !t.active)
  const total = site.trackers.length || 1
  const maxExp = Math.max(1, ...CATS.map(([c]) => site.exposure[c] ?? 0))

  const switcher =
    sites.length > 1
      ? `<div class="seg">${sites.map((s) => `<a class="seg-i ${s.url === site.url ? "is-on" : ""}" href="${siteHref(s.url)}">${esc(hostOfUrl(s.url))}</a>`).join("")}</div>`
      : `<span class="chip">${icon("globe", 14)} ${esc(hostOfUrl(site.url))}</span>`

  return `
  <div class="toolbar">
    ${switcher}
    <div class="tools">
      ${local ? `<a class="btn-ic" href="#/audit/${encodeURIComponent(site.url)}" title="Audit now" aria-label="Audit now">${icon("play", 16)}</a>` : ""}
      <button class="btn-ic" data-act="print" title="Export exhibit" aria-label="Export exhibit">${icon("print", 17)}</button>
      <button class="btn-ic" data-act="share" title="Copy link" aria-label="Copy link">${icon("link", 17)}</button>
      <a class="btn-ic" href="${txUrl(last.tx)}" target="_blank" rel="noopener" title="Latest audit on Etherscan" aria-label="Latest audit on Etherscan">${icon("ext", 17)}</a>
    </div>
  </div>

  <div class="grid">
    <section class="card span-4 score-card">
      <header class="card-h"><h2>Compliance</h2>${pill(g.label, g.tone)}</header>
      <div class="gauge-wrap">${gauge(site.score, g.tone)}
        <div class="gauge-num"><strong>${site.score}</strong>
          ${prev ? `<span class="delta ${delta >= 0 ? "up" : "down"}">${delta >= 0 ? "▲" : "▼"} ${Math.abs(delta)}</span>` : ""}
        </div>
      </div>
      <div class="mini-row">
        <div><span class="k">Audits</span><b>${site.audits.length}</b></div>
        <div><span class="k">Last</span><b>${ago(last.at)}</b></div>
        <div><span class="k">Longest</span><b>${span(site.longest)}</b></div>
      </div>
    </section>

    <section class="card span-8 live-card">
      <header class="card-h"><h2>Live on page</h2><span class="muted-s">${icon("clock", 14)} ${full(last.at)}</span></header>
      <div class="live">
        <div class="browser">
          <div class="b-bar"><i></i><i></i><i></i><span>${esc(site.url)}</span></div>
          <div class="b-body">
            ${
              active.length
                ? `<div class="pins">${active
                    .map((t, i) => `<button class="pin tone-${SEV_TONE[t.severity]}" data-host="${esc(t.host)}" style="--d:${i * 60}ms">${avatar(t.entity, SEV_TONE[t.severity])}<span>${esc(t.entity)}</span></button>`)
                    .join("")}</div>`
                : `<div class="clean">${icon("shield", 34)}<b>No trackers</b></div>`
            }
          </div>
        </div>
        <div class="metrics">
          <div class="metric"><span class="k">Active</span><strong>${active.length}</strong>${pill(active.length ? "Attention" : "Clear", active.length ? "red" : "green")}</div>
          <div class="metric"><span class="k">High severity</span><strong>${site.activeBySeverity.high}</strong>${pill(`${Math.round((site.activeBySeverity.high / total) * 100)}%`, site.activeBySeverity.high ? "red" : "green")}</div>
          <div class="metric"><span class="k">Remediated</span><strong>${remediated.length}</strong>${pill(remediated.length ? "Fixed" : "—", remediated.length ? "green" : "muted")}</div>
        </div>
      </div>
    </section>

    <div class="col span-4">
    <section class="card grow">
      <header class="card-h"><h2>Exposure</h2><span class="btn-ic sm" title="Active trackers by category">${icon("scan", 15)}</span></header>
      ${radar(CATS.map(([, n]) => n), CATS.map(([c]) => site.exposure[c] ?? 0), maxExp)}
      <ol class="legend">${CATS.map(
        ([c, n], i) => `<li><span class="n">${i + 1}</span>${n}<i></i>${pill(String(site.exposure[c] ?? 0), (site.exposure[c] ?? 0) ? (c === Category.Analytics || c === Category.TagManager ? "amber" : "red") : "green")}</li>`,
      ).join("")}</ol>
    </section>

    </div>

    <div class="col span-8">
    <section class="card">
      <header class="card-h"><h2>Observation record</h2>
        <span class="key"><span class="dot x">${icon("x", 10)}</span>Present <span class="dot ok">${icon("check", 10)}</span>Absent</span></header>
      ${obsGrid(site)}
    </section>

    <div class="duo">
    <section class="card">
      <header class="card-h"><h2>Severity mix</h2><span class="btn-ic sm">${icon("alert", 15)}</span></header>
      ${mix(site)}
    </section>
    <section class="card">
      <header class="card-h"><h2>Audit trail</h2><span class="btn-ic sm" title="${CHAIN.name}">${icon("chain", 15)}</span></header>
      <ol class="trail">${[...site.audits]
        .reverse()
        .map(
          (a) => `<li class="${a.highCount ? "bad" : "good"}">
          <span class="t-ic">${a.highCount ? `<b>${a.trackerCount}</b>` : icon("check", 16)}</span>
          <div><b>#${a.id}</b><span>${day(a.at)} · ${time(a.at)}</span>
          <a href="${txUrl(a.tx)}" target="_blank" rel="noopener" class="mono" title="${a.evidenceHash}">${short(a.evidenceHash, 4)} ${icon("ext", 12)}</a></div></li>`,
        )
        .join("")}</ol>
    </section>
    </div>
    </div>

    <section class="card span-12">
      <header class="card-h"><h2>Trackers</h2><span class="muted-s">${site.trackers.length} observed</span></header>
      ${trackerTable(site)}
    </section>
  </div>
  <div id="drawer" class="drawer" hidden></div>`
}

const obsGrid = (site: Site) => {
  if (!site.trackers.length) return `<div class="clean sm">${icon("shield", 26)}<b>Clean on every audit</b></div>`
  const cols = site.audits.slice(-12)
  return `<div class="obs-wrap"><table class="obs">
    <thead><tr><th></th>${cols.map((a) => `<th title="${full(a.at)}"><span>#${a.id}</span><small>${day(a.at)}</small></th>`).join("")}</tr></thead>
    <tbody>${site.trackers
      .map(
        (t) => `<tr><th>${avatar(t.entity, SEV_TONE[t.severity])}<span class="mono">${esc(t.host)}</span></th>${cols
          .map((a) => (a.hosts.has(t.host) ? `<td><span class="dot x" title="Present · ${full(a.at)}">${icon("x", 11)}</span></td>` : `<td><span class="dot ok" title="Absent · ${full(a.at)}">${icon("check", 11)}</span></td>`))
          .join("")}</tr>`,
      )
      .join("")}</tbody></table></div>`
}

const mix = (site: Site) => {
  const total = site.trackers.length
  if (!total) return `<div class="clean sm">${icon("shield", 26)}<b>Nothing to grade</b></div>`
  const high = site.activeBySeverity.high
  const other = site.activeBySeverity.medium + site.activeBySeverity.review
  const fixed = site.trackers.filter((t) => !t.active).length
  const pct = (n: number) => Math.round((n / total) * 100)
  const cols = [
    { k: "High", n: high, cls: "seg-red" },
    { k: "Review", n: other, cls: "seg-amber" },
    { k: "Fixed", n: fixed, cls: "seg-hatch" },
  ]
  return `<div class="mix">
    <div class="mix-cols">${cols.map((c) => `<div><span class="k">${c.k}</span><strong>${pct(c.n)}%</strong></div>`).join("")}</div>
    <div class="mix-bar">${cols.map((c) => (c.n ? `<span class="${c.cls}" style="flex:${c.n}"></span>` : "")).join("")}</div>
  </div>
  <div class="dials">
    ${tickDial(high / total, "red", `<b>${high}</b>`)}
    ${tickDial(other / total, "amber", `<b>${other}</b>`)}
    ${tickDial(fixed / total, "green", `<b>${fixed}</b>`)}
  </div>`
}

const trackerTable = (site: Site) => {
  if (!site.trackers.length) return `<div class="clean sm">${icon("shield", 26)}<b>No third parties observed</b></div>`
  return `<div class="tbl-wrap"><table class="tbl">
    <thead><tr><th>Tracker</th><th>Category</th><th>Severity</th><th>Seen</th><th>First → last</th><th>Status</th><th></th></tr></thead>
    <tbody>${site.trackers
      .map(
        (t) => `<tr class="row ${t.active ? "" : "is-fixed"}" data-host="${esc(t.host)}" tabindex="0">
        <td><div class="who">${avatar(t.entity, SEV_TONE[t.severity])}<div><b>${esc(t.entity)}</b><span class="mono">${esc(t.host)}</span></div></div></td>
        <td><span class="chip">${catName(t.category)}</span></td>
        <td>${pill(SEV[t.severity], SEV_TONE[t.severity])}</td>
        <td><div class="seen">${Array.from({ length: site.audits.length }, (_, i) => `<i class="${i < t.observations ? "on" : ""}"></i>`).slice(0, 12).join("")}<b>${t.observations}×</b></div></td>
        <td class="nowrap">${day(t.firstSeen)} → ${day(t.lastSeen)} <span class="muted-s">${span(t.lastSeen - t.firstSeen)}</span></td>
        <td>${pill(t.active ? "Active" : "Remediated", t.active ? "red" : "green")}</td>
        <td class="chev">${icon("arrow", 16)}</td></tr>`,
      )
      .join("")}</tbody></table></div>`
}

const openDrawer = (site: Site, host: string) => {
  const t = site.trackers.find((x) => x.host === host)
  if (!t) return
  const f = assess(t.category, t.severity !== Severity.None)
  const d = $("#drawer")
  d.hidden = false
  d.innerHTML = `<div class="drawer-bg" data-close></div>
  <aside class="drawer-panel" role="dialog" aria-label="${esc(t.entity)}">
    <header>${avatar(t.entity, SEV_TONE[t.severity])}<div><h3>${esc(t.entity)}</h3><span class="mono">${esc(t.host)}</span></div>
      <button class="btn-ic" data-close aria-label="Close">${icon("x", 16)}</button></header>
    <div class="d-pills">${pill(SEV[t.severity], SEV_TONE[t.severity])}<span class="chip">${catName(t.category)}</span>${pill(t.active ? "Active" : "Remediated", t.active ? "red" : "green")}</div>
    <div class="d-stats">
      <div><span class="k">First seen</span><b>${full(t.firstSeen)}</b></div>
      <div><span class="k">Last seen</span><b>${full(t.lastSeen)}</b></div>
      <div><span class="k">Observed</span><b>${t.observations}× over ${span(t.lastSeen - t.firstSeen)}</b></div>
    </div>
    <p class="d-why">${esc(f.rationale)}</p>
    <h4>${icon("scale", 15)} 16 CFR Part 312</h4>
    <ul class="cites">${f.provisions.map((p) => `<li><cite>${esc(p.cite)}</cite><span>${esc(p.summary)}</span></li>`).join("")}</ul>
  </aside>`
  requestAnimationFrame(() => d.classList.add("open"))
  d.querySelectorAll("[data-close]").forEach((el) => el.addEventListener("click", closeDrawer))
}
const closeDrawer = () => {
  const d = document.getElementById("drawer")
  if (!d) return
  d.classList.remove("open")
  setTimeout(() => (d.hidden = true), 220)
}

const printExhibit = (site: Site) => {
  const last = site.audits[site.audits.length - 1]
  const w = window.open("", "_blank")
  if (!w) return toast("Allow pop-ups to export")
  const rows = site.trackers
    .map((t) => {
      const f = assess(t.category, t.severity !== Severity.None)
      return `<tr><td><b>${esc(t.entity)}</b><br><code>${esc(t.host)}</code></td><td>${catName(t.category)}</td><td>${SEV[t.severity]}</td>
        <td>${full(t.firstSeen)}<br>${full(t.lastSeen)}</td><td>${t.observations}</td><td>${t.active ? "Active" : "Remediated"}</td>
        <td>${f.provisions.map((p) => esc(p.cite)).join("<br>")}</td></tr>`
    })
    .join("")
  const trail = site.audits
    .map((a) => `<tr><td>#${a.id}</td><td>${full(a.at)}</td><td>${a.trackerCount}</td><td>${a.highCount}</td><td><code>${a.evidenceHash}</code></td><td><code>${a.tx}</code></td></tr>`)
    .join("")
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Exhibit · ${esc(site.url)}</title>
  <style>body{font:12px/1.45 Georgia,serif;color:#111;margin:40px}h1{font-size:22px;margin:0}h2{font-size:14px;margin:28px 0 8px;text-transform:uppercase;letter-spacing:.08em}
  table{width:100%;border-collapse:collapse}td,th{border:1px solid #bbb;padding:6px;text-align:left;vertical-align:top}th{background:#f2f2f2}code{font:10.5px ui-monospace,monospace;word-break:break-all}
  .meta{color:#555;margin-top:6px}.note{color:#555;font-size:11px;margin-top:24px}</style></head><body>
  <p class="meta">EXHIBIT · Hall Monitor children's-privacy audit record</p>
  <h1>${esc(site.url)}</h1>
  <p class="meta">Compliance score ${site.score}/100 · ${site.audits.length} audits · latest ${full(last.at)} · contract ${HALL_MONITOR} on ${CHAIN.name}</p>
  <h2>Trackers observed</h2><table><tr><th>Tracker</th><th>Category</th><th>Severity</th><th>First / last seen</th><th>Seen</th><th>Status</th><th>Provisions</th></tr>${rows || '<tr><td colspan="7">None</td></tr>'}</table>
  <h2>Audit trail</h2><table><tr><th>Audit</th><th>Observed</th><th>Third parties</th><th>High</th><th>Evidence hash</th><th>Transaction</th></tr>${trail}</table>
  <p class="note">Each audit was observed by Chainlink CRE nodes, agreed by consensus and written by a DON-signed report. Verify any evidence pack at ${location.origin}/app#/verify. Automated observation flagged for legal review, not a finding of liability.</p>
  <script>onload=()=>print()</script></body></html>`)
  w.document.close()
}

// ------------------------------------------------------------------ sites

const sitesView = () => {
  if (loadError) return emptyState("Couldn't reach the chain", loadError)
  const avg = sites.length ? Math.round(sites.reduce((s, x) => s + x.score, 0) / sites.length) : 0
  const issues = sites.reduce((s, x) => s + x.trackers.filter((t) => t.active).length, 0)
  const days = Array.from({ length: 7 }, (_, i) => {
    const start = new Date()
    start.setHours(0, 0, 0, 0)
    start.setDate(start.getDate() - (6 - i))
    const s = start.getTime() / 1000
    return { label: start.toLocaleDateString(undefined, { weekday: "narrow" }), n: audits.filter((a) => a.at >= s && a.at < s + 86400).length }
  })
  const maxDay = Math.max(1, ...days.map((d) => d.n))

  return `
  <div class="grid">
    <section class="card span-3 kpi"><span class="k">Sites monitored</span><strong>${sites.length}</strong>
      <div class="gstrip">${sites.map((s) => `<i class="tone-${grade(s.score).tone}" title="${esc(hostOfUrl(s.url))} · ${s.score}"></i>`).join("")}</div></section>
    <section class="card span-3 kpi"><span class="k">Average score</span><div class="kpi-row"><strong>${avg}</strong>${ring(avg, grade(avg).tone, 46)}</div></section>
    <section class="card span-3 kpi"><span class="k">Active trackers</span><strong class="${issues ? "t-red" : ""}">${issues}</strong>
      <div class="sevstrip">${(() => {
        const h = sites.reduce((n, x) => n + x.activeBySeverity.high, 0)
        const r = sites.reduce((n, x) => n + x.activeBySeverity.medium + x.activeBySeverity.review, 0)
        return issues ? `<i class="seg-red" style="flex:${h}"></i><i class="seg-amber" style="flex:${r}"></i>` : `<i class="seg-hatch" style="flex:1"></i>`
      })()}</div></section>
    <section class="card span-3 kpi"><span class="k">Audits · 7 days</span><strong>${days.reduce((s, d) => s + d.n, 0)}</strong>
      <div class="spark days">${days.map((d) => `<i class="${d.n ? "tone-green" : ""}" style="height:${Math.max(8, (d.n / maxDay) * 100)}%" title="${d.n}"></i>`).join("")}</div></section>

    <section class="card span-12 urlbar">
      <span class="ub-ic">${icon("sparkle", 16)}</span>
      <form id="quick" class="ub-form"><input name="url" type="url" placeholder="https://kids-site.example" value="${local ? DEMO_URL : ""}" required aria-label="URL to audit">
      <button class="btn-primary" ${local ? "" : "disabled title='Runs locally with the CRE CLI'"}>${icon("play", 14)} Start audit</button></form>
    </section>

    <section class="card span-12">
      <header class="card-h"><h2>Monitored sites</h2></header>
      ${
        sites.length
          ? `<div class="tbl-wrap"><table class="tbl sites">
        <thead><tr><th>Site</th><th>Score</th><th>Issues</th><th>Audits</th><th>Longest</th><th>Last audit</th><th></th></tr></thead>
        <tbody>${sites
          .map((s) => {
            const g = grade(s.score)
            const last = s.audits[s.audits.length - 1]
            const b = s.activeBySeverity
            return `<tr class="row" data-href="${siteHref(s.url)}" tabindex="0">
            <td><div class="who">${avatar(hostOfUrl(s.url), g.tone)}<div><b>${esc(hostOfUrl(s.url))}</b><span class="mono">${esc(s.url)}</span></div></div></td>
            <td>${ring(s.score, g.tone)}</td>
            <td><div class="badges">${b.high ? pill(`${b.high} high`, "red") : ""}${b.medium + b.review ? pill(`${b.medium + b.review} review`, "amber") : ""}${!b.high && !b.medium && !b.review ? pill("clean", "green") : ""}</div></td>
            <td><b>${s.audits.length}</b></td>
            <td>${span(s.longest)}</td>
            <td>${ago(last.at)}</td>
            <td class="nowrap"><a class="btn-dark" href="${siteHref(s.url)}">Open</a></td></tr>`
          })
          .join("")}</tbody></table></div>`
          : `<div class="clean sm">${icon("globe", 26)}<b>No sites yet</b></div>`
      }
    </section>
  </div>`
}

// ------------------------------------------------------------------ audit

const STAGES = [
  { k: "fetch", label: "Fetch", ic: "globe" },
  { k: "extract", label: "Extract", ic: "scan" },
  { k: "consensus", label: "Consensus", ic: "nodes" },
  { k: "map", label: "COPPA map", ic: "scale" },
  { k: "seal", label: "Seal on-chain", ic: "seal" },
]

const auditView = (url?: string) => `
  <div class="grid">
    <section class="card span-12 urlbar">
      <span class="ub-ic">${icon("sparkle", 16)}</span>
      <form id="audit-form" class="ub-form">
        <input name="url" type="url" required value="${esc(url ?? DEMO_URL)}" aria-label="URL to audit" ${local ? "" : "disabled"}>
        <label class="sw"><input type="checkbox" name="childDirected" checked ${local ? "" : "disabled"}><span></span>Child-directed</label>
        <label class="sw"><input type="checkbox" name="broadcast" checked ${local ? "" : "disabled"}><span></span>On-chain</label>
        <button class="btn-primary" ${local ? "" : "disabled"}>${icon("play", 14)} Start audit</button>
      </form>
    </section>
    ${
      local
        ? ""
        : `<section class="card span-12 banner">${icon("terminal", 20)}<div><b>Live audits run locally</b><code>git clone ${GITHUB} && bun install && bun run dev</code></div>
           <button class="btn-ic" data-copy="git clone ${GITHUB}.git && cd hall-monitor && bun install && bun run dev" aria-label="Copy command">${icon("copy", 16)}</button></section>`
    }
    <section class="card span-12">
      <ol class="pipeline" id="pipeline">${STAGES.map(
        (s, i) => `<li data-stage="${s.k}"><span class="p-ic">${icon(s.ic, 22)}</span><b>${s.label}</b><span class="p-n">${i + 1}</span></li>`,
      ).join("")}</ol>
    </section>
    <section class="card span-8" id="result-card">
      <header class="card-h"><h2>Result</h2><span id="result-meta" class="muted-s"></span></header>
      <div id="result"><div class="clean sm">${icon("file", 26)}<b>Waiting for an audit</b></div></div>
    </section>
    <section class="card span-4">
      <header class="card-h"><h2>KidQuest demo</h2>${icon("globe", 16)}</header>
      <div class="demo">
        <div class="demo-state" id="demo-state"><span class="big-dot"></span><b>—</b></div>
        <label class="sw lg"><input type="checkbox" id="demo-toggle" ${local ? "" : "disabled"}><span></span>Trackers planted</label>
        <a class="link-s" href="${DEMO_URL}" target="_blank" rel="noopener">${icon("ext", 13)} Open site</a>
      </div>
    </section>
    <section class="card span-12">
      <details class="log"><summary>${icon("terminal", 15)} Raw CRE log</summary><pre id="console" class="console"></pre></details>
    </section>
  </div>`

let lastPackJson: string | undefined

/** Log lines arrive in bursts, so the pipeline steps one stage at a time toward the latest target. */
let stageCur = -1
let stageGoal = -1
let stageEnd: "active" | "done" | "error" = "active"
let stageTimer: ReturnType<typeof setInterval> | undefined

const paintStages = (cur: number, state: "active" | "done" | "error") =>
  document.querySelectorAll<HTMLLIElement>("#pipeline li").forEach((li, i) => {
    li.classList.remove("active", "done", "error")
    if (i < cur || (i === cur && state === "done")) li.classList.add("done")
    else if (i === cur) li.classList.add(state)
  })

const setStage = (k: string, state: "active" | "done" | "error") => {
  const idx = STAGES.findIndex((s) => s.k === k)
  if (state === "error") {
    clearInterval(stageTimer)
    stageTimer = undefined
    stageCur = Math.max(stageCur, 0)
    return paintStages(stageCur, "error")
  }
  stageGoal = Math.max(stageGoal, idx)
  stageEnd = state
  if (stageTimer) return
  const tick = () => {
    if (stageCur < stageGoal) stageCur++
    const atGoal = stageCur === stageGoal
    paintStages(stageCur, atGoal ? stageEnd : "active")
    if (atGoal) {
      clearInterval(stageTimer)
      stageTimer = undefined
    }
  }
  tick()
  stageTimer = setInterval(tick, 480)
}

const resetStages = () => {
  clearInterval(stageTimer)
  stageTimer = undefined
  stageCur = -1
  stageGoal = -1
  paintStages(-1, "active")
}

const runAudit = async (form: HTMLFormElement) => {
  const data = new FormData(form)
  const body = { url: String(data.get("url")), childDirected: data.get("childDirected") === "on", broadcast: data.get("broadcast") === "on" }
  const btn = $("button.btn-primary", form) as HTMLButtonElement
  const con = $("#console")
  btn.disabled = true
  btn.innerHTML = `<span class="spin"></span> Auditing`
  con.textContent = ""
  resetStages()
  $("#result").innerHTML = `<div class="clean sm pulse">${icon("nodes", 26)}<b>Nodes observing</b></div>`
  $("#result-meta").textContent = ""
  setStage("fetch", "active")
  const log = (t: string) => {
    con.textContent += t + "\n"
    con.scrollTop = con.scrollHeight
  }
  try {
    const res = await fetch("/api/audit", { method: "POST", body: JSON.stringify(body) })
    if (!res.ok || !res.body) throw new Error(await res.text())
    const reader = res.body.pipeThrough(new TextDecoderStream()).getReader()
    let buf = ""
    for (;;) {
      const { value, done } = await reader.read()
      if (done) break
      buf += value
      let i: number
      while ((i = buf.indexOf("\n\n")) >= 0) {
        const msg = buf.slice(0, i)
        buf = buf.slice(i + 2)
        const event = /^event: (.*)$/m.exec(msg)?.[1] ?? "line"
        const payload = msg.replace(/^event: .*\n/m, "").replace(/^data: /gm, "")
        if (event === "line") {
          if (!payload.includes("EVIDENCE_PACK")) log(payload)
          if (/Running trigger/.test(payload)) setStage("extract", "active")
          if (/third parties/.test(payload)) setStage("map", "active")
          if (/evidence hash/.test(payload)) setStage("seal", "active")
        } else if (event === "done") {
          const r = JSON.parse(payload) as { tx?: string; hash?: string; pack?: EvidencePack; packJson?: string; error?: string }
          lastPackJson = r.packJson
          if (r.error) {
            setStage("fetch", "error")
            $("#result").innerHTML = `<div class="clean sm bad">${icon("alert", 26)}<b>${esc(r.error)}</b></div>`
          } else {
            setStage("seal", "done")
            if (r.pack) $("#result").innerHTML = resultCard(r.pack, r.hash!, r.tx)
            const onchain = r.tx && !/^0x0+$/.test(r.tx)
            $("#result-meta").innerHTML = onchain ? `<a href="${txUrl(r.tx!)}" target="_blank" rel="noopener">${icon("ext", 13)} ${short(r.tx!)}</a>` : "simulated · not written"
            if (onchain) {
              toast("Audit sealed on-chain")
              await refresh()
            }
          }
        }
      }
    }
  } catch (e) {
    setStage("fetch", "error")
    $("#result").innerHTML = `<div class="clean sm bad">${icon("alert", 26)}<b>${esc(String(e))}</b></div>`
  } finally {
    btn.disabled = false
    btn.innerHTML = `${icon("play", 14)} Start audit`
  }
}

const resultCard = (p: EvidencePack, hash: string, tx?: string) => {
  const g = grade(
    Math.max(0, 100 - p.summary.high * 18 - p.summary.medium * 9 - p.summary.review * 3),
  )
  const score = Math.max(0, 100 - p.summary.high * 18 - p.summary.medium * 9 - p.summary.review * 3)
  return `<div class="result">
    <div class="res-score">${ring(score, g.tone, 88)}${pill(g.label, g.tone)}</div>
    <div class="res-body">
      <div class="res-counts">
        <div><strong>${p.summary.thirdParties}</strong><span class="k">Third parties</span></div>
        <div><strong class="t-red">${p.summary.high}</strong><span class="k">High</span></div>
        <div><strong class="t-amber">${p.summary.medium + p.summary.review}</strong><span class="k">Review</span></div>
      </div>
      <div class="res-chips">${p.findings.map((f) => `<span class="chip tone-${SEV_TONE[SEV.indexOf(f.severity as (typeof SEV)[number])]}">${avatar(f.entity, SEV_TONE[SEV.indexOf(f.severity as (typeof SEV)[number])])}${esc(f.entity)}</span>`).join("")}</div>
      <div class="res-foot"><code title="${hash}">${short(hash, 10)}</code>
        <button class="btn-ghost" data-act="dl-pack">${icon("download", 14)} Evidence pack</button>
        ${tx && !/^0x0+$/.test(tx) ? `<a class="btn-ghost" href="${siteHref(p.url)}">${icon("arrow", 14)} Case file</a>` : ""}</div>
    </div></div>`
}

const demo = async (action: "remediate" | "regress" | "state") => {
  const el = document.getElementById("demo-state")
  try {
    const r = await fetch(`/api/demo/${action}`, { method: action === "state" ? "GET" : "POST" })
    const { trackers } = (await r.json()) as { trackers: boolean }
    if (el) {
      el.className = `demo-state ${trackers ? "on" : "off"}`
      el.innerHTML = `<span class="big-dot"></span><b>${trackers ? "Tracking kids" : "Remediated"}</b>`
    }
    const tg = document.getElementById("demo-toggle") as HTMLInputElement | null
    if (tg) tg.checked = trackers
  } catch {
    if (el) el.innerHTML = `<span class="big-dot"></span><b>Offline</b>`
  }
}

// ------------------------------------------------------------------ verify

const verifyView = () => `
  <div class="grid">
    <section class="card span-12">
      <label class="drop" id="drop">
        <input id="file" type="file" accept=".json,.log,.txt" hidden>
        <span class="drop-ic">${icon("upload", 26)}</span>
        <b>Drop an evidence pack</b>
        <span class="muted-s">.json or workflow .log</span>
      </label>
      <div class="center"><button class="btn-ghost" id="sample">${icon("file", 14)} Try audit #0</button></div>
    </section>
    <section class="card span-12" id="verify-card" hidden>
      <header class="card-h"><h2>Exhibit check</h2><span id="v-meta" class="muted-s mono"></span></header>
      <div class="checks" id="checks"></div>
    </section>
  </div>`

const checkCard = (state: "ok" | "bad" | "wait", ic: string, title: string, sub: string) =>
  `<div class="check ${state}"><span class="c-ic">${state === "wait" ? '<span class="spin"></span>' : icon(state === "ok" ? "check" : "x", 22)}</span>
   <span class="c-step">${icon(ic, 16)}</span><b>${title}</b><span class="muted-s">${sub}</span></div>`

const parsePack = (text: string): EvidencePack => {
  const chunks = [...text.matchAll(/EVIDENCE_PACK (\d+)\/(\d+) (.*)$/gm)]
  const raw = chunks.length ? chunks.sort((a, b) => Number(a[1]) - Number(b[1])).map((m) => m[3]).join("") : text.trim()
  return JSON.parse(raw) as EvidencePack
}

const verify = async (file: File) => {
  $("#verify-card").hidden = false
  const out = $("#checks")
  let pack: EvidencePack
  try {
    pack = parsePack(await file.text())
  } catch {
    out.innerHTML = checkCard("bad", "file", "Not a pack", "Expected pack JSON or a CRE log")
    return
  }
  const hash = keccak256(toBytes(JSON.stringify(pack)))
  const rebuilt = buildPack(pack.url, Math.floor(Date.parse(pack.observedAt) / 1000), pack.audience === "child-directed", pack.findings.map((f) => ({ host: f.host, via: f.via })))
  const rulesOk = rebuilt.hash === hash
  $("#v-meta").textContent = `${hostOfUrl(pack.url)} · ${short(hash, 8)}`
  const a = checkCard("ok", "file", "Parsed", `${pack.findings.length} findings`)
  const b = checkCard(rulesOk ? "ok" : "bad", "scale", rulesOk ? "Rules reproduce" : "Findings edited", rulesOk ? "Every severity and citation re-derived" : "Doesn't match published rules")
  out.innerHTML = a + b + checkCard("wait", "chain", "On-chain", "Looking up hash")
  let c: string
  try {
    const ids = await client.readContract({ address: HALL_MONITOR, abi: HallMonitorAbi, functionName: "auditsFor", args: [pageIdOf(pack.url)] })
    let match: { id: bigint; at: bigint } | undefined
    for (const id of ids) {
      const [, at, h] = await client.readContract({ address: HALL_MONITOR, abi: HallMonitorAbi, functionName: "audits", args: [id] })
      if (h === hash) match = { id, at }
    }
    const row = match && audits.find((x) => x.id === Number(match!.id))
    c = match
      ? checkCard("ok", "seal", `Sealed · audit #${match.id}`, `${full(Number(match.at))}${row ? ` · <a href="${txUrl(row.tx)}" target="_blank" rel="noopener">${short(row.tx)}</a>` : ""}`)
      : checkCard("bad", "seal", "Not on-chain", "No audit carries this hash")
  } catch (e) {
    c = checkCard("bad", "chain", "Chain unreachable", esc(String(e)).slice(0, 80))
  }
  out.innerHTML = a + b + c
  const all = rulesOk && c.includes('class="check ok"')
  out.insertAdjacentHTML("afterend", "")
  $("#verify-card").classList.toggle("verified", all)
}

// ------------------------------------------------------------------ empty + wiring

const emptyState = (title: string, sub: string, cta = false) => `
  <div class="card empty-card">${icon("shield", 40)}<h2>${esc(title)}</h2><p class="muted-s">${esc(sub)}</p>
  ${cta && local ? `<a class="btn-primary" href="#/audit">${icon("play", 14)} Run audit</a>` : ""}</div>`

const wire = (route: Route) => {
  const view = $("#view")
  if (route.name === "overview" && sites.length) {
    const site = sites.find((s) => s.url === route.url) ?? sites[0]
    view.querySelectorAll<HTMLElement>("tr.row, .pin").forEach((el) => {
      const open = () => openDrawer(site, el.dataset.host!)
      el.addEventListener("click", open)
      el.addEventListener("keydown", (e) => (e as KeyboardEvent).key === "Enter" && open())
    })
    view.querySelector('[data-act="print"]')?.addEventListener("click", () => printExhibit(site))
    view.querySelector('[data-act="share"]')?.addEventListener("click", async () => {
      await navigator.clipboard.writeText(`${location.origin}${location.pathname}${siteHref(site.url)}`).catch(() => {})
      toast("Link copied")
    })
  }
  if (route.name === "sites") {
    view.querySelectorAll<HTMLElement>("tr.row").forEach((el) => {
      el.addEventListener("click", (e) => {
        if ((e.target as HTMLElement).closest("a")) return
        location.hash = el.dataset.href!
      })
      el.addEventListener("keydown", (e) => (e as KeyboardEvent).key === "Enter" && (location.hash = el.dataset.href!))
    })
    $("#quick")?.addEventListener("submit", (e) => {
      e.preventDefault()
      const url = String(new FormData(e.target as HTMLFormElement).get("url"))
      sessionStorage.setItem("hm:autorun", "1")
      location.hash = `#/audit/${encodeURIComponent(url)}`
    })
  }
  if (route.name === "audit") {
    const form = $("#audit-form") as HTMLFormElement
    form.addEventListener("submit", (e) => {
      e.preventDefault()
      runAudit(form)
    })
    view.querySelector("[data-copy]")?.addEventListener("click", async (e) => {
      await navigator.clipboard.writeText((e.currentTarget as HTMLElement).dataset.copy!).catch(() => {})
      toast("Command copied")
    })
    view.addEventListener("click", (e) => {
      if (!(e.target as HTMLElement).closest('[data-act="dl-pack"]') || !lastPackJson) return
      const a = document.createElement("a")
      a.href = URL.createObjectURL(new Blob([lastPackJson], { type: "application/json" }))
      a.download = "evidence-pack.json"
      a.click()
    })
    if (local) {
      demo("state")
      $("#demo-toggle").addEventListener("change", (e) => demo((e.target as HTMLInputElement).checked ? "regress" : "remediate"))
      let auto = false
      try {
        auto = sessionStorage.getItem("hm:autorun") === "1"
        sessionStorage.removeItem("hm:autorun")
      } catch {}
      if (auto) runAudit(form)
    }
  }
  if (route.name === "verify") {
    const drop = $("#drop")
    const input = $("#file") as HTMLInputElement
    drop.addEventListener("dragover", (e) => {
      e.preventDefault()
      drop.classList.add("over")
    })
    drop.addEventListener("dragleave", () => drop.classList.remove("over"))
    drop.addEventListener("drop", (e) => {
      e.preventDefault()
      drop.classList.remove("over")
      const f = e.dataTransfer?.files[0]
      if (f) verify(f)
    })
    input.addEventListener("change", () => input.files?.[0] && verify(input.files[0]))
    $("#sample").addEventListener("click", async () => {
      const text = await fetch("/sample-pack.json").then((r) => r.text())
      verify(new File([text], "audit0.pack.json"))
    })
  }
}

const refresh = async () => {
  try {
    const r = await loadSites()
    sites = r.sites
    audits = r.audits
    loadError = ""
  } catch (e) {
    loadError = String(e).slice(0, 160)
  }
  loaded = true
  $("#net-audits").textContent = String(audits.length)
  if (parseRoute().name !== "audit") render()
}

const boot = async () => {
  $("#contract-link").setAttribute("href", `${CHAIN.explorer}/address/${HALL_MONITOR}`)
  $("#gh-link").setAttribute("href", GITHUB)
  document.addEventListener("keydown", (e) => e.key === "Escape" && closeDrawer())
  window.addEventListener("hashchange", () => {
    closeDrawer()
    render()
  })
  try {
    local = (await fetch("/api/health").then((r) => r.json()))?.local === true
  } catch {
    local = false
  }
  document.body.classList.toggle("is-local", local)
  render()
  await refresh()
  if (parseRoute().name === "audit") render()
}

boot()
