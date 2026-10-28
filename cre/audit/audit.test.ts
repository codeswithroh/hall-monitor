import { describe, expect, test } from "bun:test"
import { extractThirdParties, hostOf } from "./extract"
import { buildPack } from "./pack"

const html = await Bun.file(new URL("../../demo-site/trackers.html", import.meta.url)).text()
const page = `<html><head>${html}<script src="/assets/game.js"></script><a href="https://example.org">x</a></head></html>`

describe("extract", () => {
  test("hostOf handles protocol-relative, ports and relatives", () => {
    expect(hostOf("//cdn.Example.com/x.js")).toBe("cdn.example.com")
    expect(hostOf("http://localhost:8787/")).toBe("localhost")
    expect(hostOf("/assets/game.js")).toBeUndefined()
  })

  test("finds every planted tracker, ignores first-party and plain links", () => {
    const hosts = extractThirdParties(page, "http://localhost:8787/").map((o) => o.host)
    expect(hosts).toEqual([
      "analytics.tiktok.com",
      "connect.facebook.net",
      "securepubads.g.doubleclick.net",
      "static.hotjar.com",
      "www.facebook.com",
      "www.googletagmanager.com",
    ])
  })

  test("is deterministic", () => {
    const a = JSON.stringify(extractThirdParties(page, "http://localhost:8787/"))
    const b = JSON.stringify(extractThirdParties(page, "http://localhost:8787/"))
    expect(a).toBe(b)
  })
})

describe("pack", () => {
  test("classifies and hashes reproducibly", () => {
    const obs = extractThirdParties(page, "http://localhost:8787/")
    const a = buildPack("http://localhost:8787/", 1_800_000_000, true, obs)
    const b = buildPack("http://localhost:8787/", 1_800_000_000, true, obs)
    expect(a.hash).toBe(b.hash)
    expect(a.pack.summary).toEqual({ thirdParties: 6, high: 5, medium: 0, review: 1 })
    expect(a.pack.findings.find((f) => f.host === "static.hotjar.com")?.category).toBe("SessionReplay")
  })

  test("clean page yields an empty pack", () => {
    const p = buildPack("http://localhost:8787/", 1_800_000_000, true, [])
    expect(p.hosts).toEqual([])
    expect(p.pack.summary.thirdParties).toBe(0)
  })
})
