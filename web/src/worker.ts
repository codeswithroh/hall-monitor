/**
 * Cloudflare Worker: static landing + dashboard (assets), the hosted audit API, and a hosted copy of
 * the KidQuest demo site. One Durable Object ("hub") holds the demo toggle, serializes audits so the
 * signing wallet's nonces never collide, and rate-limits on-chain writes.
 */
import { DurableObject } from "cloudflare:workers"
import kidquestPage from "../../demo-site/index.html"
import kidquestTrackers from "../../demo-site/trackers.html"
import { runAudit, type Emit, type RunnerEnv } from "./runner"

type Env = {
  ASSETS: Fetcher
  HUB: DurableObjectNamespace<Hub>
  SEPOLIA_RPC: string
  HALL_MONITOR: `0x${string}`
  CRE_FORWARDER: `0x${string}`
  CRE_ETH_PRIVATE_KEY?: string
}

const DEMO_PATH = "/kidquest/"
const LIMITS = { globalGapSec: 12, perIpPerHour: 12, perDay: 300 }

const renderKidQuest = (trackersOn: boolean) => {
  const [, head = "", body = ""] = kidquestTrackers.split(/<!--HEAD-->|<!--BODY-->/)
  return kidquestPage
    .replace("<!--TRACKERS:HEAD-->", trackersOn ? head.trim() : "")
    .replace("<!--TRACKERS:BODY-->", trackersOn ? body.trim() : "")
    .replaceAll('"/assets/', `"${DEMO_PATH}assets/`)
}

const sse = (event: string, data: string) => `event: ${event}\n${data.split("\n").map((l) => `data: ${l}`).join("\n")}\n\n`

export class Hub extends DurableObject<Env> {
  private busy = false

  async trackersOn(): Promise<boolean> {
    return (await this.ctx.storage.get<boolean>("trackersOn")) ?? true
  }

  async setTrackers(on: boolean): Promise<boolean> {
    await this.ctx.storage.put("trackersOn", on)
    return on
  }

  /** Returns an error message when the caller should back off, otherwise records the attempt. */
  private async admit(ip: string): Promise<string | undefined> {
    const now = Math.floor(Date.now() / 1000)
    const last = (await this.ctx.storage.get<number>("lastOnchainAt")) ?? 0
    if (now - last < LIMITS.globalGapSec) return `Another audit was just sealed. Try again in ${LIMITS.globalGapSec - (now - last)}s.`
    const dayKey = `day:${new Date().toISOString().slice(0, 10)}`
    const today = (await this.ctx.storage.get<number>(dayKey)) ?? 0
    if (today >= LIMITS.perDay) return "Daily on-chain audit limit reached. Dry runs still work."
    const ipKey = `ip:${ip}`
    const hits = ((await this.ctx.storage.get<number[]>(ipKey)) ?? []).filter((t) => now - t < 3600)
    if (hits.length >= LIMITS.perIpPerHour) return "You've hit the hourly on-chain limit. Dry runs still work."
    await this.ctx.storage.put({ lastOnchainAt: now, [dayKey]: today + 1, [ipKey]: [...hits, now] })
    return undefined
  }

  async fetch(req: Request): Promise<Response> {
    const { url, childDirected = true, broadcast = true, ip = "?", origin } = (await req.json()) as {
      url: string
      childDirected?: boolean
      broadcast?: boolean
      ip?: string
      origin: string
    }
    if (this.busy) return new Response("An audit is already running. Try again in a few seconds.", { status: 409 })
    if (broadcast) {
      const refusal = await this.admit(ip)
      if (refusal) return new Response(refusal, { status: 429 })
    }
    this.busy = true

    const trackersOn = await this.trackersOn()
    const demoUrl = `${origin}${DEMO_PATH}`
    // The Worker can't fetch its own hostname, so the hosted demo page is rendered in-process.
    const fetcher = async (target: string) => {
      if (target === demoUrl || target === `${origin}/kidquest`) return renderKidQuest(trackersOn)
      const res = await fetch(target, {
        headers: { "User-Agent": "HallMonitor/0.1 (+children's-privacy audit)", Accept: "text/html,*/*" },
        redirect: "follow",
        signal: AbortSignal.timeout(10_000),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return (await res.text()).slice(0, 1_500_000)
    }

    const env: RunnerEnv = {
      rpc: this.env.SEPOLIA_RPC,
      hallMonitor: this.env.HALL_MONITOR,
      forwarder: this.env.CRE_FORWARDER,
      privateKey: this.env.CRE_ETH_PRIVATE_KEY,
    }
    const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>()
    const writer = writable.getWriter()
    const enc = new TextEncoder()
    const emit: Emit = (event, data) => void writer.write(enc.encode(sse(event, data)))

    this.ctx.waitUntil(
      (async () => {
        try {
          await runAudit({ url, childDirected, broadcast }, env, emit, fetcher)
        } catch (e) {
          const msg = String((e as Error).message ?? e).split("\n")[0].slice(0, 240)
          emit("line", `✗ ${msg}`)
          emit("done", JSON.stringify({ error: msg }))
        } finally {
          this.busy = false
          await writer.close().catch(() => {})
        }
      })(),
    )
    return new Response(readable, { headers: { "content-type": "text/event-stream", "cache-control": "no-cache" } })
  }
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const u = new URL(req.url)
    const hub = env.HUB.get(env.HUB.idFromName("hub"))

    if (u.pathname === "/api/health") return Response.json({ local: false, hosted: true, demoUrl: `${u.origin}${DEMO_PATH}` })

    if (u.pathname === "/api/audit" && req.method === "POST") {
      let body: { url?: string; childDirected?: boolean; broadcast?: boolean }
      try {
        body = await req.json()
      } catch {
        return new Response("Invalid JSON", { status: 400 })
      }
      if (!/^https?:\/\/[^\s/]+/.test(body.url ?? "")) return new Response("Enter a full http(s) URL", { status: 400 })
      if (/^https?:\/\/(localhost|127\.|0\.0\.0\.0|\[::1\]|10\.|192\.168\.|169\.254\.)/i.test(body.url!))
        return new Response("The hosted runner can't reach local or private addresses. Try the hosted KidQuest demo.", { status: 400 })
      return hub.fetch("https://hub/audit", {
        method: "POST",
        body: JSON.stringify({ ...body, ip: req.headers.get("cf-connecting-ip") ?? "?", origin: u.origin }),
      })
    }

    const demo = /^\/api\/demo\/(remediate|regress|state)$/.exec(u.pathname)
    if (demo) {
      const on = demo[1] === "state" ? await hub.trackersOn() : await hub.setTrackers(demo[1] === "regress")
      return Response.json({ trackers: on })
    }

    if (u.pathname === "/kidquest") return Response.redirect(`${u.origin}${DEMO_PATH}`, 301)
    if (u.pathname === DEMO_PATH || u.pathname === `${DEMO_PATH}index.html`)
      return new Response(renderKidQuest(await hub.trackersOn()), {
        headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
      })

    return env.ASSETS.fetch(req)
  },
}
