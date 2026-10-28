/**
 * Static extraction of third-party hosts from raw HTML. Runs inside the CRE WASM runtime, so there is
 * no DOM and no URL class: plain regexes and string handling only. Must be deterministic so every
 * DON node produces byte-identical output for identical HTML.
 */

export type Observation = { host: string; via: string }

/** Lowercased hostname, or undefined for relative / non-http references. */
export const hostOf = (ref: string): string | undefined => {
  const m = /^(?:https?:)?\/\/([^/?#:\s"'<>]+)/i.exec(ref.trim())
  return m ? m[1].toLowerCase().replace(/\.$/, "") : undefined
}

/** Registrable-domain approximation: last two labels. Good enough to separate first from third party here. */
const siteOf = (host: string): string => {
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host) || host === "localhost") return host
  return host.split(".").slice(-2).join(".")
}

const TAG_ATTRS: Array<[string, RegExp]> = [
  ["script", /<script\b[^>]*?\bsrc\s*=\s*["']([^"']+)["']/gi],
  ["img", /<img\b[^>]*?\bsrc\s*=\s*["']([^"']+)["']/gi],
  ["iframe", /<iframe\b[^>]*?\bsrc\s*=\s*["']([^"']+)["']/gi],
  ["link", /<link\b[^>]*?\bhref\s*=\s*["']([^"']+)["']/gi],
]

/** URLs written inside inline <script> bodies, e.g. snippet loaders that inject a tag at runtime. */
const INLINE_SCRIPT = /<script\b(?![^>]*\bsrc\s*=)[^>]*>([\s\S]*?)<\/script>/gi
const URL_IN_JS = /(?:https?:)?\/\/[a-z0-9.-]+\.[a-z]{2,}(?=[/"'?\s])/gi

export const extractThirdParties = (html: string, pageUrl: string): Observation[] => {
  const pageHost = hostOf(pageUrl) ?? ""
  const firstParty = siteOf(pageHost.split(":")[0])
  const seen = new Map<string, Set<string>>()
  const add = (ref: string, via: string) => {
    const host = hostOf(ref)
    if (!host || siteOf(host) === firstParty) return
    if (!seen.has(host)) seen.set(host, new Set())
    seen.get(host)!.add(via)
  }

  for (const [via, re] of TAG_ATTRS) {
    for (const m of html.matchAll(re)) add(m[1], via)
  }
  for (const m of html.matchAll(INLINE_SCRIPT)) {
    for (const u of m[1].matchAll(URL_IN_JS)) add(u[0], "inline-script")
  }

  return [...seen.entries()]
    .map(([host, vias]) => ({ host, via: [...vias].sort().join("+") }))
    .sort((a, b) => (a.host < b.host ? -1 : a.host > b.host ? 1 : 0))
}
