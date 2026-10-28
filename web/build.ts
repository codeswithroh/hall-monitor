/**
 * Static build for hosting (Cloudflare):
 *   dist/index.html        landing
 *   dist/app/index.html    dashboard
 *   dist/assets/*          bundled JS + CSS
 */
import { cp, mkdir, rm } from "node:fs/promises"

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
  await Promise.all([
    cp(`${dir}/index.html`, `${out}/index.html`),
    cp(`${dir}/app/index.html`, `${out}/app/index.html`),
    cp(`${dir}/landing.css`, `${out}/assets/landing.css`),
    cp(`${dir}/app.css`, `${out}/assets/app.css`),
    cp(`${dir}/favicon.svg`, `${out}/favicon.svg`),
    cp(`${dir}/../evidence/audit1.pack.json`, `${out}/sample-pack.json`),
  ])
}

if (import.meta.main) {
  await rm(out, { recursive: true, force: true })
  await build()
  console.log(`built ${out}`)
}
