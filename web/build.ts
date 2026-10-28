/**
 * Static build for hosting (Cloudflare):
 *   dist/index.html        landing
 *   dist/app/index.html    dashboard
 *   dist/assets/*          bundled JS + CSS
 *   dist/kidquest/assets/* hosted demo site's static files (its HTML is rendered by the Worker)
 */
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises"

const dir = import.meta.dir
const out = `${dir}/dist`

export const build = async () => {
  await mkdir(`${out}/app`, { recursive: true })
  const res = await Bun.build({
    entrypoints: [`${dir}/src/landing.ts`, `${dir}/src/dashboard.ts`],
    outdir: `${out}/assets`,
    target: "browser",
    minify: true,
    splitting: true,
    naming: { entry: "[name].js", chunk: "chunk-[hash].js" },
  })
  if (!res.success) throw new AggregateError(res.logs, "build failed")
  // Asset names are stable, so stamp each build into the HTML references to bust browser caches.
  const v = Date.now().toString(36)
  const stamp = async (from: string, to: string) =>
    writeFile(to, (await readFile(from, "utf8")).replace(/(\/assets\/[\w-]+\.(?:js|css))"/g, `$1?v=${v}"`))
  await Promise.all([
    stamp(`${dir}/index.html`, `${out}/index.html`),
    stamp(`${dir}/app/index.html`, `${out}/app/index.html`),
    cp(`${dir}/landing.css`, `${out}/assets/landing.css`),
    cp(`${dir}/app.css`, `${out}/assets/app.css`),
    cp(`${dir}/favicon.svg`, `${out}/favicon.svg`),
    cp(`${dir}/../evidence/audit1.pack.json`, `${out}/sample-pack.json`),
    cp(`${dir}/../demo-site/assets`, `${out}/kidquest/assets`, { recursive: true }),
  ])
}

if (import.meta.main) {
  await rm(out, { recursive: true, force: true })
  await build()
  console.log(`built ${out}`)
}
