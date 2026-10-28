// Films the product footage. Copy to <workdir>/film.mjs, then write one scripted, deterministic "shot" per
// thing the narration shows. Run:  node film.mjs            → shots/<name>/*.jpg + stamps.json, shots/events.json
//
// Why this way (learned the hard way):
//  - Playwright's recordVideo is low-bitrate VP8 — unusable at 1080p. A CDP screencast of JPEG frames with
//    per-frame timestamps is crisp and lets build_bg.py time-fit any slice of a recording to any shot length.
//  - Headed Chrome (headless:false) keeps the GPU on: WebGL/canvas apps render at full speed and quality.
//  - ev() logs the recording-clock time of every interesting moment (click, kill, modal opens). Shots in
//    project.json reference those times ("rec": "main", "t": 12.4, "to": 18.0) and SFX cues can too.
//  - Pre-seed localStorage (skip tutorials/cookie banners, fixed username), use test wallets/accounts you own,
//    and hide dev overlays. Film each beat 2-3x longer than the line it covers; the edit trims.
import fs from "node:fs";
import { createRequire } from "node:module";
const TB = process.env.PITCH_VIDEO_HOME || `${process.env.HOME}/.cache/pitch-video`;
const { chromium } = createRequire(`${TB}/package.json`)("playwright");

const URL = process.env.APP_URL || "http://localhost:5173/";
// Film at the canvas size: 1920x1080, or 1080x960 for "layout": "split" (sites render their tablet layout,
// which fills the top half without letterboxing).
const SPLIT = fs.existsSync("project.json") && JSON.parse(fs.readFileSync("project.json", "utf8")).layout === "split";
const VW = SPLIT ? 1080 : 1920, VH = SPLIT ? 960 : 1080;
const OUT = "shots";
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const T0 = Date.now();
const events = fs.existsSync(`${OUT}/events.json`) ? JSON.parse(fs.readFileSync(`${OUT}/events.json`, "utf8")) : [];
const ev = (shot, what, extra = {}) => {
  const e = { t: +((Date.now() - T0) / 1000).toFixed(3), shot, what, ...extra };
  events.push(e);
  console.log(e.t.toFixed(2), shot, what, JSON.stringify(extra));
  fs.writeFileSync(`${OUT}/events.json`, JSON.stringify(events, null, 1));
};

const browser = await chromium.launch({
  headless: false,
  args: [`--window-size=${VW},${VH + 100}`, "--force-device-scale-factor=1", "--autoplay-policy=no-user-gesture-required"],
});

/** Continuous screencast of `page` into shots/<name>/ (≈30 fps JPEG) with timestamps on the ev() clock. */
async function recorder(ctx, page, name) {
  const dir = `${OUT}/${name}`;
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const cdp = await ctx.newCDPSession(page);
  const stamps = [];
  let n = 0;
  cdp.on("Page.screencastFrame", async (f) => {
    const i = n++;
    fs.writeFile(`${dir}/${String(i).padStart(6, "0")}.jpg`, Buffer.from(f.data, "base64"), () => {});
    stamps.push([i, f.metadata.timestamp]);
    cdp.send("Page.screencastFrameAck", { sessionId: f.sessionId }).catch(() => {});
  });
  const dpr = await page.evaluate(() => devicePixelRatio);
  await cdp.send("Page.startScreencast", { format: "jpeg", quality: 88, maxWidth: VW * dpr, maxHeight: VH * dpr, everyNthFrame: 2 });
  const startedAt = (Date.now() - T0) / 1000;
  ev(name, "rec-start");
  return {
    async stop() {
      await cdp.send("Page.stopScreencast").catch(() => {});
      await sleep(500);
      fs.writeFileSync(`${dir}/stamps.json`, JSON.stringify({ startedAt, stamps }));
      ev(name, "rec-stop", { frames: stamps.length });
    },
  };
}

async function newPage(seed = {}, { hidpi = false, dark = false } = {}) {
  // hidpi: 2x pixels, for cinematic shots (cine.py magnifies UI up to 6x and needs the extra resolution)
  // dark: prefers-color-scheme dark (sites that follow the system theme look far better in cine shots)
  const ctx = await browser.newContext({ viewport: { width: VW, height: VH }, deviceScaleFactor: hidpi ? 2 : 1,
    colorScheme: dark ? "dark" : "light" });
  await ctx.addInitScript((s) => { for (const [k, v] of Object.entries(s)) localStorage.setItem(k, v); }, seed);
  const page = await ctx.newPage();
  page.on("pageerror", (e) => console.log("pageerror", e.message));
  return { ctx, page };
}

/** Sharp still for a cinematic shot: stills/<name>.png plus stills/<name>.json with named subject positions
 *  (fractions of the page), e.g. still(page, "hero", { subject: "button:has-text('Deploy')" }). */
async function still(page, name, targets = {}) {
  fs.mkdirSync("stills", { recursive: true });
  const vw = page.viewportSize(), out = {};
  for (const [k, sel] of Object.entries(targets)) {
    const bb = await page.locator(sel).first().boundingBox().catch(() => null);
    const c = bb && [(bb.x + bb.width / 2) / vw.width, (bb.y + bb.height / 2) / vw.height];
    if (!c) console.log(`still ${name}: target ${k} (${sel}) not found`);
    else if (c.some((v) => v < 0 || v > 1)) console.log(`still ${name}: target ${k} is off-screen ${c}; scroll it into view first`);
    else out[k] = c.map((v) => +v.toFixed(4));
  }
  await page.screenshot({ path: `stills/${name}.png` });
  fs.writeFileSync(`stills/${name}.json`, JSON.stringify(out));
  ev("still", name, out);
}

/** Named subject position inside a recording, for cine shots that use footage: shots/<rec>/targets.json. */
async function mark(page, rec, key, sel) {
  const vw = page.viewportSize(), bb = await page.locator(sel).first().boundingBox();
  const f = `${OUT}/${rec}/targets.json`, cur = fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, "utf8")) : {};
  cur[key] = [+((bb.x + bb.width / 2) / vw.width).toFixed(4), +((bb.y + bb.height / 2) / vw.height).toFixed(4)];
  fs.writeFileSync(f, JSON.stringify(cur));
}

// ───────────────────────── shots: edit below ─────────────────────────
const B = "https://hall-monitor.codeswithroh.workers.dev";
const DEMO = `${B}/kidquest/`;
const SITE = `${B}/app/?film=1#/site/${encodeURIComponent(DEMO)}`;
const ASSETS = `file://${process.cwd()}/film_assets`;

// Screencasts don't include the OS cursor, so draw one that follows real mouse events.
const CURSOR = () => {
  const add = () => {
    if (document.getElementById("__cur")) return;
    const c = document.createElement("div");
    c.id = "__cur";
    c.style.cssText = "position:fixed;left:0;top:0;width:26px;height:26px;z-index:2147483647;pointer-events:none;transform:translate(-100px,-100px);transition:transform .05s linear";
    c.innerHTML = '<svg width="26" height="26" viewBox="0 0 24 24"><path d="M4 2l15 9-6.5 1.6L9.6 19z" fill="#111" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/></svg>';
    document.documentElement.appendChild(c);
    addEventListener("mousemove", (e) => (c.style.transform = `translate(${e.clientX - 3}px,${e.clientY - 2}px)`), true);
    addEventListener("mousedown", () => (c.firstChild.style.transform = "scale(.85)"), true);
    addEventListener("mouseup", () => (c.firstChild.style.transform = ""), true);
  };
  document.readyState === "loading" ? addEventListener("DOMContentLoaded", add) : add();
};

let mouse = { x: VW / 2, y: VH / 2 };
async function moveTo(page, sel, ms = 700) {
  const bb = await page.locator(sel).first().boundingBox();
  const x = bb.x + bb.width / 2, y = bb.y + bb.height / 2;
  await page.mouse.move(x, y, { steps: Math.max(8, Math.round(ms / 16)) });
  mouse = { x, y };
  return { x, y };
}
async function clickOn(page, sel, ms = 700) {
  await moveTo(page, sel, ms);
  await sleep(150);
  await page.mouse.down();
  await sleep(70);
  await page.mouse.up();
}
/** Eased scroll of the window (or an element) to y over ms. */
async function glide(page, y, ms, el = null) {
  await page.evaluate(async ([y, ms, el]) => {
    const t = el ? document.querySelector(el) : document.scrollingElement;
    const y0 = t.scrollTop, t0 = performance.now();
    await new Promise((res) => {
      const f = (now) => {
        const p = Math.min(1, (now - t0) / ms), e = p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2;
        t.scrollTop = y0 + (y - y0) * e;
        p < 1 ? requestAnimationFrame(f) : res();
      };
      requestAnimationFrame(f);
    });
  }, [y, ms, el]);
}
const yOf = (page, sel) => page.evaluate((s) => document.querySelector(s).getBoundingClientRect().top + scrollY, sel);
async function waitStage(page, k, cls = "done", timeout = 90000) {
  await page.waitForSelector(`#pipeline li[data-stage="${k}"].${cls}`, { timeout });
}
const api = (p, m = "GET") => fetch(`${B}${p}`, { method: m }).then((r) => r.json());

await api("/api/demo/regress", "POST"); // trackers on for the first audit
await fetch(`${B}/app/`); await api("/api/demo/state"); // warm the Durable Object

// 1. KidQuest homepage
{
  const { ctx, page } = await newPage();
  await ctx.addInitScript(CURSOR);
  await page.goto(DEMO); await page.waitForLoadState("networkidle").catch(() => {});
  const rec = await recorder(ctx, page, "kidquest");
  await sleep(800); ev("kidquest", "hero");
  await glide(page, 420, 3200); ev("kidquest", "cards");
  await sleep(800);
  await rec.stop(); await ctx.close();
}

// 2. Its source, with the tracker snippets highlighted
{
  const { ctx, page } = await newPage();
  await page.goto(`${ASSETS}/source.html`);
  const rec = await recorder(ctx, page, "kidquest_source");
  await sleep(600); ev("kidquest_source", "top");
  await page.evaluate(async () => {
    const s = document.getElementById("scroller"), t0 = performance.now(), ms = 4200, to = -260;
    await new Promise((r) => { const f = (n) => { const p = Math.min(1, (n - t0) / ms); s.style.transform = `translateY(${to * (p < .5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2)}px)`; p < 1 ? requestAnimationFrame(f) : r(); }; requestAnimationFrame(f); });
  });
  ev("kidquest_source", "scrolled"); await sleep(900);
  await rec.stop(); await ctx.close();
}

// 3. Landing page
{
  const { ctx, page } = await newPage();
  await page.goto(`${B}/?film=1`); await page.waitForLoadState("networkidle").catch(() => {});
  await sleep(1500);
  const rec = await recorder(ctx, page, "landing");
  await sleep(700); ev("landing", "hero");
  await glide(page, 560, 2600); ev("landing", "steps");
  await sleep(800);
  await rec.stop(); await ctx.close();
}

// 4-6. Live audit → result → Etherscan, one continuous session
let auditTx;
{
  const { ctx, page } = await newPage();
  await ctx.addInitScript(CURSOR);
  await page.goto(`${B}/app/?film=1#/audit`); await page.waitForSelector("#audit-form .btn-primary:not([disabled])");
  await sleep(1500);
  const rec = await recorder(ctx, page, "audit");
  await page.mouse.move(VW * 0.55, VH * 0.45);
  await sleep(600); ev("audit", "ready");
  await clickOn(page, "#audit-form .btn-primary", 900); ev("audit", "start");
  await waitStage(page, "fetch", "active", 30000).catch(() => {}); ev("audit", "fetch");
  await waitStage(page, "consensus", "done").catch(() => {}); ev("audit", "consensus");
  await waitStage(page, "seal", "done"); ev("audit", "sealed");
  await page.waitForSelector(".result"); ev("audit_result", "result");
  await page.mouse.move(VW * 0.35, VH * 0.62, { steps: 40 });
  await sleep(3500); ev("audit_result", "read");
  auditTx = await page.evaluate(() => document.querySelector("#result-meta a")?.href);
  await rec.stop();
  // Etherscan in its own recording
  const eth = await ctx.newPage();
  await eth.goto(auditTx, { waitUntil: "domcontentloaded" }).catch(() => {});
  await sleep(3500);
  const rec2 = await recorder(ctx, eth, "etherscan");
  await sleep(600); ev("etherscan", "tx");
  await glide(eth, 260, 3000); ev("etherscan", "details");
  await sleep(1200);
  await rec2.stop();
  await ctx.close();
}

// 7-8. Overview and the tracker drawer
{
  const { ctx, page } = await newPage();
  await ctx.addInitScript(CURSOR);
  await page.goto(SITE); await page.waitForSelector(".gauge-num strong", { timeout: 60000 });
  await sleep(2500);
  const rec = await recorder(ctx, page, "overview");
  await page.mouse.move(VW * 0.25, VH * 0.4);
  await sleep(500); ev("overview", "gauge");
  await moveTo(page, ".pin", 1400); ev("overview", "pins");
  await glide(page, await yOf(page, ".radar") - 160, 2600); ev("overview", "radar");
  await sleep(600);
  // drawer
  ev("drawer", "go");
  await glide(page, (await yOf(page, ".tbl")) - 220, 1800);
  await clickOn(page, 'tr.row[data-host="static.hotjar.com"]', 1000); ev("drawer", "open");
  await page.waitForSelector(".drawer.open");
  await sleep(2600);
  await moveTo(page, ".cites li:nth-child(1)", 900); ev("drawer", "cite1");
  await sleep(1800);
  await moveTo(page, ".cites li:nth-child(2)", 700); ev("drawer", "cite2");
  await sleep(1800);
  await moveTo(page, ".cites li:nth-child(3)", 700); ev("drawer", "cite3");
  await sleep(2600);
  ev("drawer", "end");
  await rec.stop(); await ctx.close();
}

// 9. Remediate: switch trackers off and re-audit
let packPath;
{
  const { ctx, page } = await newPage();
  await ctx.addInitScript(CURSOR);
  await page.goto(`${B}/app/?film=1#/audit`); await page.waitForSelector("#demo-state.on", { timeout: 60000 });
  await sleep(14000); // respect the hosted runner's 12 s gap between on-chain audits
  const rec = await recorder(ctx, page, "remediate");
  await sleep(500); ev("remediate", "ready");
  await clickOn(page, ".sw.lg span", 1000); ev("remediate", "toggle");
  await page.waitForSelector("#demo-state.off"); await sleep(600);
  await clickOn(page, "#audit-form .btn-primary", 900); ev("remediate", "start");
  await waitStage(page, "seal", "done"); await page.waitForSelector(".result"); ev("remediate", "clean");
  await sleep(2500); ev("remediate", "end");
  const dl = page.waitForEvent("download");
  await page.click('[data-act="dl-pack"]');
  packPath = `${process.cwd()}/film_assets/evidence-pack.json`;
  await (await dl).saveAs(packPath);
  await rec.stop(); await ctx.close();
}

// 10. Remediated case file
{
  const { ctx, page } = await newPage();
  await ctx.addInitScript(CURSOR);
  await page.goto(SITE.replace("film=1", "film=2"));
  await page.waitForFunction(() => document.querySelector(".gauge-num strong")?.textContent === "100", null, { timeout: 90000 }).catch(() => {});
  await sleep(2500);
  const rec = await recorder(ctx, page, "remediated");
  await page.mouse.move(VW * 0.22, VH * 0.42);
  await sleep(600); ev("remediated", "score");
  await moveTo(page, ".delta", 900); await sleep(900);
  await glide(page, (await yOf(page, ".obs")) - 200, 2400); ev("remediated", "grid");
  await sleep(1800);
  await glide(page, (await yOf(page, ".tbl")) - 160, 2200); ev("remediated", "table");
  await sleep(2600); ev("remediated", "end");
  await rec.stop(); await ctx.close();
}

// 11. Verify the downloaded evidence pack
{
  const { ctx, page } = await newPage();
  await ctx.addInitScript(CURSOR);
  await page.goto(`${B}/app/?film=3#/verify`); await page.waitForSelector("#drop");
  await sleep(2000);
  const rec = await recorder(ctx, page, "verify");
  await page.mouse.move(VW * 0.3, VH * 0.7);
  await sleep(500); ev("verify", "ready");
  await moveTo(page, "#drop", 900);
  await page.locator("#file").setInputFiles(packPath); ev("verify", "dropped");
  await page.waitForSelector("#verify-card.verified", { timeout: 60000 }); ev("verify", "checks");
  await sleep(3500); ev("verify", "end");
  await rec.stop(); await ctx.close();
}

// 12. Terminal replay of the real CRE simulation log
{
  const { ctx, page } = await newPage();
  await page.goto(`${ASSETS}/terminal.html`);
  const rec = await recorder(ctx, page, "terminal");
  await sleep(500); ev("terminal", "start");
  await page.evaluate(() => window.START());
  await page.waitForFunction(() => window.DONE === 1, null, { timeout: 60000 }); ev("terminal", "done");
  await sleep(1500);
  await rec.stop(); await ctx.close();
}

await api("/api/demo/regress", "POST"); // leave the demo ready for judges

await browser.close();
