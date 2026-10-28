/**
 * KidQuest Games demo server. Serves a fictional child-directed site with planted trackers.
 *   bun run server.ts               → http://localhost:8787  (trackers ON)
 *   curl -X POST localhost:8787/__remediate   → trackers OFF (simulates the operator fixing the site)
 *   curl -X POST localhost:8787/__regress     → trackers back ON
 *   GET /__state                     → { trackers: boolean }
 */
const PORT = Number(process.env.PORT ?? 8787)
const dir = import.meta.dir
let trackersOn = process.env.TRACKERS !== "off"

const page = await Bun.file(`${dir}/index.html`).text()
const planted = await Bun.file(`${dir}/trackers.html`).text()
const [, head = "", body = ""] = planted.split(/<!--HEAD-->|<!--BODY-->/)

const render = () =>
  page
    .replace("<!--TRACKERS:HEAD-->", trackersOn ? head.trim() : "")
    .replace("<!--TRACKERS:BODY-->", trackersOn ? body.trim() : "")

Bun.serve({
  port: PORT,
  async fetch(req) {
    const { pathname } = new URL(req.url)
    if (req.method === "POST" && pathname === "/__remediate") trackersOn = false
    if (req.method === "POST" && pathname === "/__regress") trackersOn = true
    if (pathname.startsWith("/__")) return Response.json({ trackers: trackersOn })
    if (pathname === "/" || pathname === "/index.html")
      return new Response(render(), { headers: { "content-type": "text/html; charset=utf-8" } })
    const file = Bun.file(`${dir}${pathname}`)
    return (await file.exists()) && pathname.startsWith("/assets/") ? new Response(file) : new Response("Not found", { status: 404 })
  },
})
console.log(`KidQuest Games on http://localhost:${PORT} (trackers ${trackersOn ? "ON" : "OFF"})`)
