/** Hand-rolled SVG charts: no chart library, so the bundle stays small and everything themes via CSS vars. */

const TONE: Record<string, string> = { green: "var(--green)", amber: "var(--amber)", red: "var(--red)", ink: "var(--ink)", muted: "var(--line-2)" }

/** Semicircle gauge made of ticks, like a credit-score dial. */
export const gauge = (value: number, tone: string) => {
  const ticks = 60
  const r1 = 92
  const r2 = 112
  const cx = 130
  const cy = 128
  const filled = Math.round((value / 100) * ticks)
  let lines = ""
  for (let i = 0; i <= ticks; i++) {
    const a = Math.PI - (i / ticks) * Math.PI
    const long = i % 10 === 0
    const ri = long ? r1 - 6 : r1
    const x1 = cx + ri * Math.cos(a)
    const y1 = cy - ri * Math.sin(a)
    const x2 = cx + r2 * Math.cos(a)
    const y2 = cy - r2 * Math.sin(a)
    const on = i <= filled && value > 0
    lines += `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="${on ? TONE[tone] : "var(--line)"}" stroke-width="${long ? 3 : 2.2}" stroke-linecap="round"/>`
  }
  const lbl = (v: number) => {
    const a = Math.PI - (v / 100) * Math.PI
    return `<text x="${(cx + (r2 + 14) * Math.cos(a)).toFixed(1)}" y="${(cy - (r2 + 14) * Math.sin(a) + 4).toFixed(1)}" text-anchor="middle" class="g-lbl">${v}</text>`
  }
  return `<svg viewBox="-16 -14 292 166" class="gauge" role="img" aria-label="Compliance score ${value} of 100">${lines}${[0, 50, 100].map(lbl).join("")}</svg>`
}

/** Radar over fixed axes. values are 0..max. */
export const radar = (axes: string[], values: number[], max: number) => {
  const n = axes.length
  const cx = 150
  const cy = 140
  const R = 100
  const pt = (i: number, r: number) => {
    const a = -Math.PI / 2 + (i / n) * Math.PI * 2
    return [cx + r * Math.cos(a), cy + r * Math.sin(a)]
  }
  const poly = (r: number) => Array.from({ length: n }, (_, i) => pt(i, r).map((v) => v.toFixed(1)).join(",")).join(" ")
  const rings = [0.25, 0.5, 0.75, 1].map((f) => `<polygon points="${poly(R * f)}" fill="none" stroke="var(--line)" stroke-width="1"/>`).join("")
  const spokes = axes.map((_, i) => {
    const [x, y] = pt(i, R)
    return `<line x1="${cx}" y1="${cy}" x2="${x.toFixed(1)}" y2="${y.toFixed(1)}" stroke="var(--line)"/>`
  })
  const m = Math.max(max, 1)
  const shape = values.map((v, i) => pt(i, 6 + (R - 6) * (v / m)))
  const shapeStr = shape.map((p) => p.map((v) => v.toFixed(1)).join(",")).join(" ")
  const dots = shape.map(([x, y], i) => `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="4" fill="${values[i] ? "var(--red)" : "var(--surface)"}" stroke="var(--red)" stroke-width="2"/>`)
  const labels = axes.map((_, i) => {
    const [x, y] = pt(i, R + 20)
    return `<g><circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="11" fill="var(--surface)" stroke="var(--line)"/><text x="${x.toFixed(1)}" y="${(y + 4).toFixed(1)}" text-anchor="middle" class="r-lbl">${i + 1}</text></g>`
  })
  return `<svg viewBox="0 0 300 285" class="radar" role="img" aria-label="Exposure by tracker category">${rings}${spokes.join("")}
    <polygon points="${shapeStr}" fill="color-mix(in srgb, var(--red) 16%, transparent)" stroke="var(--red)" stroke-width="2" stroke-linejoin="round"/>${dots.join("")}${labels.join("")}</svg>`
}

/** Score ring for table rows. */
export const ring = (value: number, tone: string, size = 34) => {
  const r = size / 2 - 3
  const c = 2 * Math.PI * r
  return `<svg viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" class="ring" role="img" aria-label="Score ${value}">
    <circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="var(--line)" stroke-width="3"/>
    <circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="${TONE[tone]}" stroke-width="3" stroke-linecap="round"
      stroke-dasharray="${((value / 100) * c).toFixed(1)} ${c.toFixed(1)}" transform="rotate(-90 ${size / 2} ${size / 2})"/>
    <text x="50%" y="50%" dy="3.5" text-anchor="middle" class="ring-txt">${value}</text></svg>`
}

/** Dashed tick ring around an icon, like the AI-reports dials. pct of ticks lit. */
export const tickDial = (pct: number, tone: string, inner: string) => {
  const ticks = 48
  const lit = Math.round(pct * ticks)
  let s = ""
  for (let i = 0; i < ticks; i++) {
    const a = (i / ticks) * Math.PI * 2 - Math.PI / 2
    const x1 = 60 + 44 * Math.cos(a)
    const y1 = 60 + 44 * Math.sin(a)
    const x2 = 60 + 54 * Math.cos(a)
    const y2 = 60 + 54 * Math.sin(a)
    s += `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="${i < lit ? TONE[tone] : "var(--line)"}" stroke-width="2.4" stroke-linecap="round"/>`
  }
  return `<div class="dial"><svg viewBox="0 0 120 120">${s}</svg><div class="dial-inner tone-${tone}">${inner}</div></div>`
}

// ------------------------------------------------------------------ icons (lucide-style strokes)

const P: Record<string, string> = {
  shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>',
  grid: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
  list: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
  play: '<polygon points="6 3 20 12 6 21 6 3"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  ext: '<path d="M7 17 17 7M7 7h10v10"/>',
  copy: '<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
  print: '<path d="M6 9V2h12v7M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/>',
  globe: '<circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15 15 0 0 1 0 20M12 2a15 15 0 0 0 0 20"/>',
  nodes: '<circle cx="5" cy="6" r="2"/><circle cx="19" cy="6" r="2"/><circle cx="12" cy="18" r="2"/><path d="M7 6h10M6 8l5 8M18 8l-5 8"/>',
  scan: '<path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2M7 12h10"/>',
  scale: '<path d="M12 3v18M5 21h14M3 7h18M6 7l-3 7a3 3 0 0 0 6 0L6 7M18 7l-3 7a3 3 0 0 0 6 0l-3-7"/>',
  seal: '<circle cx="12" cy="9" r="6"/><path d="M8.5 14 7 22l5-3 5 3-1.5-8"/>',
  chain: '<path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/>',
  upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12"/>',
  file: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M9 13h6M9 17h6"/>',
  github: '<path d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.9a3.4 3.4 0 0 0-.9-2.6c3.1-.4 6.4-1.5 6.4-7A5.4 5.4 0 0 0 20 4.8 5 5 0 0 0 19.9 1S18.7.6 16 2.5a13.4 13.4 0 0 0-7 0C6.3.6 5.1 1 5.1 1A5 5 0 0 0 5 4.8a5.4 5.4 0 0 0-1.5 3.7c0 5.5 3.3 6.6 6.4 7a3.4 3.4 0 0 0-.9 2.6V22"/>',
  link: '<path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/>',
  clock: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
  alert: '<path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0zM12 9v4M12 17h.01"/>',
  terminal: '<path d="m4 17 6-6-6-6M12 19h8"/>',
  arrow: '<path d="M5 12h14M12 5l7 7-7 7"/>',
  back: '<path d="M19 12H5M12 19l-7-7 7-7"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/>',
  sparkle: '<path d="M12 3l1.9 5.8L20 10.7l-5.8 1.9L12 18.5l-1.9-5.9L4 10.7l6.1-1.9z"/>',
}

export const icon = (name: keyof typeof P | string, size = 18) =>
  `<svg class="ic" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[name] ?? ""}</svg>`
