import { keccak256, toBytes, type Hex } from "viem"
import { HallMonitorAbi } from "../../cre/contracts/abi"
import { assess, Severity } from "../../cre/audit/coppa"
import { buildPack, type EvidencePack } from "../../cre/audit/pack"
import { Category, lookupTracker } from "../../cre/audit/trackers"
import { client, loadAudits, loadTrackers, pageIdOf, type AuditRow, type TrackerRow } from "./chain"
import { CHAIN, DEMO_URL, HALL_MONITOR } from "./config"

// ------------------------------------------------------------------ helpers

const $ = <T extends HTMLElement = HTMLElement>(sel: string) => document.querySelector(sel) as T
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)
const short = (h: string, n = 6) => `${h.slice(0, n + 2)}…${h.slice(-4)}`
const when = (sec: number) =>
  new Date(sec * 1000).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })
const span = (sec: number) => {
  if (sec <= 0) return "single observation"
  const d = Math.floor(sec / 86400)
  const h = Math.floor((sec % 86400) / 3600)
  const m = Math.floor((sec % 3600) / 60)
  return d ? `${d}d ${h}h` : h ? `${h}h ${m}m` : `${m}m`
}
const txLink = (tx: string) => `<a href="${CHAIN.explorer}/tx/${tx}" target="_blank" rel="noopener">${short(tx)}</a>`
const SEV_LABEL = ["None", "Review", "Medium", "High"]
const sevBadge = (s: number) => `<span class="sev sev-${SEV_LABEL[s].toLowerCase()}">${SEV_LABEL[s]}</span>`
const catLabel = (c: number) => (Category[c] ?? "Unknown").replace(/([a-z])([A-Z])/g, "$1 $2")

// ------------------------------------------------------------------ state

let audits: AuditRow[] = []
let selected: string | undefined
let localMode = false
let lastPackJson: string | undefined

// ------------------------------------------------------------------ docket + case file

const pagesFrom = (rows: AuditRow[]) => {
  const byUrl = new Map<string, AuditRow[]>()
  for (const a of rows) byUrl.set(a.url, [...(byUrl.get(a.url) ?? []), a])
  return [...byUrl.entries()].map(([url, list]) => ({ url, list, last: list[list.length - 1] }))
}

const renderDocket = () => {
  const pages = pagesFrom(audits)
  const el = $("#docket")
  if (!pages.length) {
    el.innerHTML = `<p class="empty">No audits recorded yet. Run one below.</p>`
    return
  }
  el.innerHTML = pages
    .map(
      (p, i) => `
      <button class="docket-item ${p.url === selected ? "is-selected" : ""}" data-url="${esc(p.url)}">
        <span class="docket-no">No. ${String(i + 1).padStart(3, "0")}</span>
        <span class="docket-url">${esc(p.url)}</span>
        <span class="docket-meta">${p.list.length} audit${p.list.length === 1 ? "" : "s"} · last ${when(p.last.observedAt)}</span>
        <span class="stamp ${p.last.highCount ? "stamp-red" : "stamp-green"}">${p.last.highCount ? `${p.last.highCount} high` : "Clean"}</span>
      </button>`,
    )
    .join("")
  el.querySelectorAll<HTMLButtonElement>(".docket-item").forEach((b) =>
    b.addEventListener("click", () => selectPage(b.dataset.url!)),
  )
}

const selectPage = async (url: string) => {
  selected = url
  renderDocket()
  const list = audits.filter((a) => a.url === url)
  const el = $("#casefile")
  el.hidden = false
  $("#case-url").textContent = url
  $("#case-body").innerHTML = `<p class="loading">Reading tracker history from ${CHAIN.name}…</p>`
  let trackers: TrackerRow[]
  try {
    trackers = await loadTrackers(pageIdOf(url))
  } catch (e) {
    $("#case-body").innerHTML = `<p class="error">Couldn't read the contract: ${esc(String(e))}</p>`
    return
  }
  trackers.sort((a, b) => Number(b.active) - Number(a.active) || b.severity - a.severity || a.host.localeCompare(b.host))
  const activeHigh = trackers.filter((t) => t.active && t.severity === Severity.High).length
  const longest = trackers.reduce((m, t) => Math.max(m, t.persistedSeconds), 0)

  $("#case-body").innerHTML = `
    <dl class="stats">
      <div><dt>Audits on record</dt><dd>${list.length}</dd></div>
      <div><dt>First observed</dt><dd>${when(list[0].observedAt)}</dd></div>
      <div><dt>Latest audit</dt><dd>${when(list[list.length - 1].observedAt)}</dd></div>
      <div class="${activeHigh ? "is-alarm" : ""}"><dt>Active high-severity</dt><dd>${activeHigh}</dd></div>
      <div><dt>Longest persistence</dt><dd>${span(longest)}</dd></div>
    </dl>

    <h3 class="sub">Trackers observed <span class="hint">Select a row for the COPPA provisions</span></h3>
    ${
      trackers.length
        ? `<div class="table-wrap"><table class="trackers">
        <thead><tr><th>Host</th><th>Entity</th><th>Category</th><th>Severity</th><th>First seen</th><th>Last seen</th><th>Seen</th><th>Status</th></tr></thead>
        <tbody>${trackers.map(trackerRow).join("")}</tbody></table></div>`
        : `<p class="empty">No third-party trackers have ever been observed on this page.</p>`
    }

    <h3 class="sub">Audit history</h3>
    <ol class="timeline">
      ${[...list]
        .reverse()
        .map(
          (a) => `
        <li class="${a.highCount ? "tl-red" : "tl-green"}">
          <div class="tl-head"><strong>Audit #${a.auditId}</strong><time>${when(a.observedAt)}</time></div>
          <div class="tl-body">${a.trackerCount} third part${a.trackerCount === 1 ? "y" : "ies"} · ${a.highCount} high</div>
          <div class="tl-proof"><span>Evidence hash</span> <code title="${a.evidenceHash}">${short(a.evidenceHash, 10)}</code> <span>Tx</span> ${txLink(a.tx)}</div>
        </li>`,
        )
        .join("")}
    </ol>`

  el.querySelectorAll<HTMLTableRowElement>("tr.tracker").forEach((tr) =>
    tr.addEventListener("click", () => {
      const next = tr.nextElementSibling as HTMLTableRowElement
      next.hidden = !next.hidden
      tr.classList.toggle("is-open", !next.hidden)
    }),
  )
}

const trackerRow = (t: TrackerRow) => {
  const info = lookupTracker(t.host)
  const finding = assess(t.category as Category, t.severity !== Severity.None)
  return `
    <tr class="tracker ${t.active ? "" : "is-remediated"}" tabindex="0">
      <td class="mono">${esc(t.host)}</td>
      <td>${esc(info?.entity ?? "Unknown")}</td>
      <td>${catLabel(t.category)}</td>
      <td>${sevBadge(t.severity)}</td>
      <td>${when(t.firstSeen)}</td>
      <td>${when(t.lastSeen)}</td>
      <td>${t.observations}× <span class="muted">/ ${span(t.persistedSeconds)}</span></td>
      <td><span class="stamp ${t.active ? "stamp-red" : "stamp-green"}">${t.active ? "Active" : "Remediated"}</span></td>
    </tr>
    <tr class="provisions" hidden><td colspan="8">
      <p class="rationale">${esc(finding.rationale)}</p>
      <ul>${finding.provisions.map((p) => `<li><cite>${esc(p.cite)}</cite> ${esc(p.summary)}</li>`).join("")}</ul>
    </td></tr>`
}

// ------------------------------------------------------------------ live audit (local only)

const runAudit = async (ev: SubmitEvent) => {
  ev.preventDefault()
  const form = ev.target as HTMLFormElement
  const data = new FormData(form)
  const body = {
    url: String(data.get("url")),
    childDirected: data.get("childDirected") === "on",
    broadcast: data.get("broadcast") === "on",
  }
  const btn = form.querySelector("button[type=submit]") as HTMLButtonElement
  const consoleEl = $("#console")
  const findingsEl = $("#live-findings")
  btn.disabled = true
  consoleEl.hidden = false
  consoleEl.textContent = ""
  findingsEl.innerHTML = ""
  const line = (text: string, cls = "") => {
    const div = document.createElement("div")
    div.className = cls
    div.textContent = text
    consoleEl.append(div)
    consoleEl.scrollTop = consoleEl.scrollHeight
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
          const isFinding = /\b(High|Medium|Review)\s{1,3}\S+ \(/.test(payload)
          if (!payload.includes("EVIDENCE_PACK")) line(payload, isFinding ? "c-finding" : payload.includes("✓") ? "c-ok" : "")
        } else if (event === "done") {
          const result = JSON.parse(payload) as { tx?: string; hash?: string; pack?: EvidencePack; packJson?: string; error?: string }
          lastPackJson = result.packJson
          if (result.error) line(`✗ ${result.error}`, "c-err")
          if (result.pack) findingsEl.innerHTML = packCard(result.pack, result.hash!, result.tx)
          await refresh(body.url)
        }
      }
    }
  } catch (e) {
    line(`✗ ${String(e)}`, "c-err")
  } finally {
    btn.disabled = false
  }
}

const packCard = (pack: EvidencePack, hash: string, tx?: string) => `
  <article class="exhibit">
    <header><span class="stamp stamp-red">Exhibit</span><h3>${esc(pack.url)}</h3><time>${esc(pack.observedAt)}</time></header>
    <p class="exhibit-summary">${pack.summary.thirdParties} third parties · <strong>${pack.summary.high} high</strong> · ${pack.summary.medium} medium · ${pack.summary.review} review</p>
    <ul class="exhibit-findings">${pack.findings
      .map((f) => `<li>${sevBadge(SEV_LABEL.indexOf(f.severity))} <span class="mono">${esc(f.host)}</span> <span class="muted">${esc(f.entity)}</span></li>`)
      .join("")}</ul>
    <p class="mono small">evidence hash ${esc(hash)}${tx && !/^0x0+$/.test(tx) ? ` · tx ${txLink(tx)}` : " · not broadcast"}</p>
    <button class="ghost" data-download>Download evidence pack</button>
  </article>`

const demoControl = async (action: "remediate" | "regress" | "state") => {
  try {
    const r = await fetch(`/api/demo/${action}`, { method: action === "state" ? "GET" : "POST" })
    const { trackers } = (await r.json()) as { trackers: boolean }
    $("#demo-state").textContent = trackers ? "Trackers ON" : "Trackers OFF (remediated)"
    $("#demo-state").className = `stamp ${trackers ? "stamp-red" : "stamp-green"}`
  } catch {
    $("#demo-state").textContent = "Demo site offline"
    $("#demo-state").className = "stamp"
  }
}

// ------------------------------------------------------------------ verify an exhibit (works anywhere)

const parsePack = (text: string): EvidencePack => {
  const chunks = [...text.matchAll(/EVIDENCE_PACK (\d+)\/(\d+) (.*)$/gm)]
  const raw = chunks.length ? chunks.sort((a, b) => Number(a[1]) - Number(b[1])).map((m) => m[3]).join("") : text.trim()
  return JSON.parse(raw) as EvidencePack
}

const verify = async (file: File) => {
  const out = $("#verify-out")
  const check = (ok: boolean | null, label: string, detail = "") =>
    `<li class="${ok === null ? "chk-pending" : ok ? "chk-ok" : "chk-bad"}"><span>${ok === null ? "…" : ok ? "✓" : "✗"}</span><div><strong>${label}</strong>${detail ? `<p>${detail}</p>` : ""}</div></li>`
  let pack: EvidencePack
  try {
    pack = parsePack(await file.text())
  } catch {
    out.innerHTML = `<ul class="checks">${check(false, "Not an evidence pack", "Expected pack JSON or a workflow log with EVIDENCE_PACK chunks.")}</ul>`
    return
  }
  const hash = keccak256(toBytes(JSON.stringify(pack)))
  const rebuilt = buildPack(
    pack.url,
    Math.floor(Date.parse(pack.observedAt) / 1000),
    pack.audience === "child-directed",
    pack.findings.map((f) => ({ host: f.host, via: f.via })),
  )
  const rulesOk = rebuilt.hash === hash
  const head = `<p class="mono small">${esc(file.name)} · ${esc(pack.url)} · observed ${esc(pack.observedAt)}<br>hash ${hash}</p>`
  const first = [
    check(true, "Pack parsed", `${pack.findings.length} findings, schema ${esc(pack.schema)}`),
    check(rulesOk, "Findings follow from the observations", rulesOk ? "Re-running the published COPPA rules reproduces every severity and citation." : "The severities or citations were edited after the fact."),
  ]
  out.innerHTML = head + `<ul class="checks">${first.join("")}${check(null, `Looking for this hash on ${CHAIN.name}…`)}</ul>`

  let chain: string
  try {
    const ids = await client.readContract({ address: HALL_MONITOR, abi: HallMonitorAbi, functionName: "auditsFor", args: [pageIdOf(pack.url)] })
    let match: { id: bigint; at: bigint } | undefined
    for (const id of ids) {
      const [, at, evidenceHash] = await client.readContract({ address: HALL_MONITOR, abi: HallMonitorAbi, functionName: "audits", args: [id] })
      if (evidenceHash === hash) match = { id, at }
    }
    const row = match && audits.find((a) => a.auditId === match!.id)
    chain = match
      ? check(true, `Recorded on-chain as audit #${match.id}`, `Signed by the DON and written ${when(Number(match.at))}${row ? ` in tx ${txLink(row.tx)}` : ""}. Nobody, including Hall Monitor, can change it now.`)
      : check(false, "No on-chain audit carries this hash", "Either the pack was altered or it was never broadcast.")
  } catch (e) {
    chain = check(false, "Couldn't reach the chain", esc(String(e)))
  }
  out.innerHTML = head + `<ul class="checks">${first.join("")}${chain}</ul>`
}

// ------------------------------------------------------------------ boot

const refresh = async (focus?: string) => {
  try {
    audits = await loadAudits()
  } catch (e) {
    $("#docket").innerHTML = `<p class="error">Couldn't load audits from ${CHAIN.name}: ${esc(String(e))}</p>`
    return
  }
  const pages = pagesFrom(audits)
  $("#count-audits").textContent = String(audits.length)
  $("#count-pages").textContent = String(pages.length)
  renderDocket()
  const target = focus ?? selected ?? pages[0]?.url
  if (target && pages.some((p) => p.url === target)) await selectPage(target)
}

const boot = async () => {
  $("#contract").innerHTML = `<a href="${CHAIN.explorer}/address/${HALL_MONITOR}" target="_blank" rel="noopener">${short(HALL_MONITOR)}</a>`
  $("#network").textContent = CHAIN.name

  try {
    localMode = (await fetch("/api/health").then((r) => r.json()))?.local === true
  } catch {
    localMode = false
  }
  $("#run-local").hidden = !localMode
  $("#run-hosted").hidden = localMode
  if (localMode) {
    ;($("#url") as HTMLInputElement).value = DEMO_URL
    $("#audit-form").addEventListener("submit", (e) => runAudit(e as SubmitEvent))
    document.querySelectorAll<HTMLButtonElement>("[data-demo]").forEach((b) =>
      b.addEventListener("click", () => demoControl(b.dataset.demo as "remediate" | "regress")),
    )
    demoControl("state")
  }

  $("#live-findings").addEventListener("click", (e) => {
    if (!(e.target as HTMLElement).matches("[data-download]")) return
    if (!lastPackJson) return
    const a = document.createElement("a")
    a.href = URL.createObjectURL(new Blob([lastPackJson], { type: "application/json" }))
    a.download = "evidence-pack.json"
    a.click()
  })

  const drop = $("#drop")
  const input = $("#file") as HTMLInputElement
  drop.addEventListener("dragover", (e) => {
    e.preventDefault()
    drop.classList.add("is-over")
  })
  drop.addEventListener("dragleave", () => drop.classList.remove("is-over"))
  drop.addEventListener("drop", (e) => {
    e.preventDefault()
    drop.classList.remove("is-over")
    const f = e.dataTransfer?.files[0]
    if (f) verify(f)
  })
  input.addEventListener("change", () => input.files?.[0] && verify(input.files[0]))
  $("#sample").addEventListener("click", async () => {
    const text = await fetch("sample-pack.json").then((r) => r.text())
    verify(new File([text], "audit1.pack.json"))
  })

  await refresh()
}

boot()
