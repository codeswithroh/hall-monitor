/** Static build for hosting (Cloudflare): web/dist with index.html, app.js, styles.css, sample-pack.json. */
import { cp, mkdir, rm } from "node:fs/promises"

const dir = import.meta.dir
const out = `${dir}/dist`

export const build = async () => {
  const res = await Bun.build({
    entrypoints: [`${dir}/src/app.ts`],
    outdir: out,
    target: "browser",
    minify: true,
    naming: "app.js",
  })
  if (!res.success) throw new AggregateError(res.logs, "build failed")
  await cp(`${dir}/index.html`, `${out}/index.html`)
  await cp(`${dir}/styles.css`, `${out}/styles.css`)
  await cp(`${dir}/../evidence/audit1.pack.json`, `${out}/sample-pack.json`)
}

if (import.meta.main) {
  await rm(out, { recursive: true, force: true })
  await mkdir(out, { recursive: true })
  await build()
  console.log(`built ${out}`)
}
