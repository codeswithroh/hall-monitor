import { loadSites } from "./data"

const count = (el: HTMLElement | null, to: number) => {
  if (!el) return
  const start = performance.now()
  const step = (t: number) => {
    const p = Math.min(1, (t - start) / 700)
    el.textContent = String(Math.round(to * (1 - Math.pow(1 - p, 3))))
    if (p < 1) requestAnimationFrame(step)
  }
  requestAnimationFrame(step)
}

loadSites()
  .then(({ sites, audits }) => {
    count(document.getElementById("s-audits"), audits.length)
    count(document.getElementById("s-trackers"), sites.reduce((n, s) => n + s.trackers.length, 0))
    count(document.getElementById("s-sites"), sites.length)
  })
  .catch(() => {})
