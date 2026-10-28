/**
 * Local dashboard: serves the built frontend plus an API that runs the real CRE workflow.
 *   bun run web/server.ts   → http://localhost:5173
 * POST /api/audit streams `cre workflow simulate` output as server-sent events.
 */
import { build } from "./build"

const PORT = Number(process.env.WEB_PORT ?? 5173)
const DEMO = process.env.DEMO_ORIGIN ?? "http://localhost:8787"
const dir = import.meta.dir
const creDir = `${dir}/../cre`
const configPath = `${creDir}/audit/config.staging.json`
const ANSI = /\x1b\[[0-9;]*[A-Za-z]/g
/** CLI chrome that isn't part of the audit: upgrade notices, the deploy upsell box. */
const NOISE = /Update available|cre update|cre-cli\/releases|Simulation complete|cre account access|^[│╭╰|]|^⚠️/

let running = false

const sse = (event: string, data: string) => `event: ${event}\n${data.split("\n").map((l) => `data: ${l}`).join("\n")}\n\n`

const audit = async (req: Request) => {
  if (running) return new Response("An audit is already running", { status: 409 })
  const { url, childDirected = true, broadcast = true } = (await req.json()) as {
    url: string
    childDirected?: boolean
    broadcast?: boolean
  }
  if (!/^https?:\/\//.test(url ?? "")) return new Response("url must be http(s)", { status: 400 })
  running = true

  const original = await Bun.file(configPath).text()
  const cfg = JSON.parse(original)
  cfg.targets = [{ url, childDirected }]
  await Bun.write(configPath, JSON.stringify(cfg, null, 2) + "\n")

  const args = ["workflow", "simulate", "audit", "--target", "staging-settings", "--non-interactive", "--trigger-index", "0"]
  if (broadcast) args.push("--broadcast")
  const proc = Bun.spawn(["cre", ...args], { cwd: creDir, stdout: "pipe", stderr: "pipe" })

  const enc = new TextEncoder()
  const stream = new ReadableStream({
    async start(ctl) {
      const send = (e: string, d: string) => ctl.enqueue(enc.encode(sse(e, d)))
      const chunks: Array<[number, string]> = []
      let hash: string | undefined
      let tx: string | undefined
      let error: string | undefined
      const pump = async (s: ReadableStream<Uint8Array>) => {
        let buf = ""
        for await (const part of s.pipeThrough(new TextDecoderStream())) {
          buf += part
          const lines = buf.split("\n")
          buf = lines.pop()!
          for (const raw of lines) {
            const line = raw.replace(ANSI, "").trimEnd()
            if (!line || NOISE.test(line.trim())) continue
            const c = /EVIDENCE_PACK (\d+)\/\d+ (.*)$/.exec(line)
            if (c) chunks.push([Number(c[1]), c[2]])
            hash = /evidence hash (0x[0-9a-f]{64})/.exec(line)?.[1] ?? hash
            tx = /audit report → tx (0x[0-9a-f]{64})/.exec(line)?.[1] ?? tx
            if (/^✗/.test(line)) error = line.replace(/^✗\s*/, "")
            send("line", line.replace(/^\S+Z \[USER LOG\] /, "").replace(/^\S+Z \[SIMULATION\] /, "· "))
          }
        }
      }
      try {
        await Promise.all([pump(proc.stdout), pump(proc.stderr)])
        const code = await proc.exited
        const packJson = chunks.sort((a, b) => a[0] - b[0]).map((c) => c[1]).join("")
        if (code !== 0 && !error) error = `cre exited with code ${code}`
        send("done", JSON.stringify({ hash, tx, error, packJson: packJson || undefined, pack: packJson ? JSON.parse(packJson) : undefined }))
      } finally {
        await Bun.write(configPath, original)
        running = false
        ctl.close()
      }
    },
  })
  return new Response(stream, { headers: { "content-type": "text/event-stream", "cache-control": "no-cache" } })
}

await build()
Bun.serve({
  port: PORT,
  idleTimeout: 255,
  async fetch(req) {
    const { pathname } = new URL(req.url)
    if (pathname === "/api/health") return Response.json({ local: true, demoUrl: `${DEMO}/` })
    if (pathname === "/api/audit" && req.method === "POST") return audit(req)
    const demo = /^\/api\/demo\/(remediate|regress|state)$/.exec(pathname)
    if (demo) {
      const r = await fetch(`${DEMO}/__${demo[1]}`, { method: demo[1] === "state" ? "GET" : "POST" }).catch(() => null)
      return r ? Response.json(await r.json()) : Response.json({ error: "demo site offline" }, { status: 502 })
    }
    if (pathname === "/app") return Response.redirect("/app/", 301)
    if (pathname === "/" || pathname === "/app/") await build() // rebuild on page load while developing
    const path = pathname.endsWith("/") ? `${pathname}index.html` : pathname
    const file = Bun.file(`${dir}/dist${path}`)
    return (await file.exists()) ? new Response(file) : new Response("Not found", { status: 404 })
  },
})
console.log(`Hall Monitor dashboard on http://localhost:${PORT}`)
