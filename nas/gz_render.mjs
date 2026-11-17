// Gearizo: capture the text/image layers of an editable video as transparent PNG frames, using Chrome headless.
// Usage: node gz_render.mjs <job.json> <outDir> <gzlayers.js> [chrome path] [--stills=1,2.5]
// With job.film (animated scene templates, gzscenes.js next to gzlayers.js) every frame is captured as JPEG
// (f00001.jpg… at job.fps); --stills only writes PNGs at those seconds, for checking.
// job.json is the edit doc with each image layer's src.file set to a local file path.
// Writes <outDir>/f00001.png ... and <outDir>/layers.ffconcat (each frame held until the next change), and prints
// {"frames":N,"captures":M} on stdout. Stickers are left out: gz_edit.py overlays those clips with ffmpeg.
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { pathToFileURL } from "node:url";

const argv = process.argv.slice(2), stillsArg = argv.find((a) => a.startsWith("--stills="));
const [jobPath, outDir, gzlPath, chromeArg] = argv.filter((a) => !a.startsWith("--"));
const STILLS = stillsArg ? stillsArg.slice(9).split(",").map(Number).filter((x) => x >= 0) : null;
const doc = JSON.parse(readFileSync(jobPath, "utf8"));
const W = Math.round(doc.w), H = Math.round(doc.h), DUR = Number(doc.dur), FPS = Number(doc.fps) || 30;
if (!(W > 0 && H > 0 && DUR > 0)) { console.error("job needs w, h and dur"); process.exit(2); }
const CHROME = [chromeArg, "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/usr/bin/google-chrome", "/usr/bin/chromium"].find((p) => p && existsSync(p));
if (!CHROME) { console.error("Google Chrome not found"); process.exit(2); }

const html = `<!doctype html><html><head><meta charset="utf-8">
<link rel="stylesheet" href="${(globalThis.GZL_FONTS || "")}">
<style>html,body{margin:0;padding:0;background:transparent;width:${W}px;height:${H}px;overflow:hidden}#s{position:relative;width:${W}px;height:${H}px;overflow:hidden}</style>
<link rel="stylesheet" id="f2"><script src="${pathToFileURL(gzlPath).href}"></script><script src="${pathToFileURL(join(dirname(gzlPath), "gzscenes.js")).href}"></script></head>
<body><div id="s"><div id="film" style="position:absolute;inset:0"></div></div>
<script>document.head.querySelector('link').href=GZL.fontsHref();document.getElementById('f2').href=GZS.fontsHref();window.DOC=${JSON.stringify(doc).replace(/</g, "\\u003c")};
const PROJ=${JSON.stringify(doc.projUrl || "")}, BRAND=${JSON.stringify(pathToFileURL(join(dirname(gzlPath), "brand")).href + "/")};
window.U=u=>/^(https?|file|data):/.test(u)?u:u.startsWith("brand/")?BRAND+u.slice(6):PROJ+u;
window.FRAME=(t,all)=>{ if(DOC.film) GZS.render(document.getElementById('film'),DOC.film,t,{url:U,all}); return GZL.render(document.getElementById('s'),DOC,t,{render:true,local:true,all}); };</script></body></html>`;
const page = join(outDir, "render.html");
writeFileSync(page, html);

const profile = mkdtempSync(join(tmpdir(), "gz-chrome-"));
const chrome = spawn(CHROME, ["--headless=new", "--remote-debugging-port=0", "--user-data-dir=" + profile, "--no-first-run", "--no-default-browser-check",
  "--hide-scrollbars", "--mute-audio", "--allow-file-access-from-files", "--force-device-scale-factor=1", "--disable-gpu-vsync", "about:blank"], { stdio: ["ignore", "ignore", "pipe"] });
const wsUrl = await new Promise((res, rej) => {
  let buf = ""; const to = setTimeout(() => rej(new Error("Chrome did not start")), 30000);
  chrome.stderr.on("data", (d) => { buf += d; const m = /DevTools listening on (ws:\/\/\S+)/.exec(buf); if (m) { clearTimeout(to); res(m[1]); } });
  chrome.on("exit", (c) => rej(new Error("Chrome exited " + c)));
});
const ws = new WebSocket(wsUrl);
await new Promise((r, j) => { ws.onopen = r; ws.onerror = () => j(new Error("could not talk to Chrome")); });
let seq = 0; const waiting = new Map(), events = [];
ws.onmessage = (m) => {
  const msg = JSON.parse(m.data);
  if (msg.id && waiting.has(msg.id)) { const w = waiting.get(msg.id); waiting.delete(msg.id); msg.error ? w.j(new Error(msg.error.message)) : w.r(msg.result); }
  else if (msg.method) events.forEach((f) => f(msg));
};
const send = (method, params = {}, sessionId) => new Promise((r, j) => { const id = ++seq; waiting.set(id, { r, j }); ws.send(JSON.stringify({ id, method, params, sessionId })); });

let code = 0;
try {
  const { targetId } = await send("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true });
  const S = (m, p) => send(m, p, sessionId);
  const ev = async (expr) => { const r = await S("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text); return r.result.value; };
  await S("Page.enable");
  await S("Emulation.setDeviceMetricsOverride", { width: W, height: H, deviceScaleFactor: 1, mobile: false });
  await S("Emulation.setDefaultBackgroundColorOverride", { color: { r: 0, g: 0, b: 0, a: 0 } });
  const loaded = new Promise((r) => events.push((m) => { if (m.method === "Page.loadEventFired" && m.sessionId === sessionId) r(); }));
  await S("Page.navigate", { url: pathToFileURL(page).href });
  await loaded;
  // draw every layer once so its fonts and images load, then wait for them
  await ev(`(async()=>{FRAME(0,true);
    await document.fonts.ready;await Promise.all([...document.images].map(i=>i.decode().catch(()=>{})));
    await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));return document.fonts.size})()`);
  if (STILLS || doc.film) {
    await ev(`new Promise(r=>setTimeout(r,300))`);
    const list = STILLS || Array.from({ length: Math.round(DUR * FPS) }, (_, i) => i / FPS);
    let n = 0;
    for (const t of list) {
      await ev(`FRAME(${t})`);
      const { data } = await S("Page.captureScreenshot", STILLS ? { format: "png", fromSurface: true } : { format: "jpeg", quality: 92, fromSurface: true });
      writeFileSync(join(outDir, STILLS ? "still_" + t + ".png" : "f" + String(++n).padStart(5, "0") + ".jpg"), Buffer.from(data, "base64"));
    }
    process.stdout.write(JSON.stringify({ frames: list.length, captures: list.length, film: true }) + "\n");
    throw { done: true };
  }
  const times = await ev(`GZL.captureTimes(DOC,${FPS})`);
  const list = ["ffconcat version 1.0"];
  let prevKey = null, prevFile = null, captures = 0, frames = 0;
  for (let i = 0; i < times.length; i++) {
    const t = times[i], next = i + 1 < times.length ? times[i + 1] : DUR;
    const key = await ev(`FRAME(${t})`);
    if (key !== prevKey) {
      const { data } = await S("Page.captureScreenshot", { format: "png", fromSurface: true, captureBeyondViewport: false });
      prevFile = "f" + String(++captures).padStart(5, "0") + ".png";
      writeFileSync(join(outDir, prevFile), Buffer.from(data, "base64"));
      prevKey = key;
    }
    list.push("file '" + prevFile + "'", "duration " + Math.max(0.001, next - t).toFixed(4));
    frames++;
  }
  list.push("file '" + prevFile + "'");   // the concat format needs the last file twice for its duration to count
  writeFileSync(join(outDir, "layers.ffconcat"), list.join("\n") + "\n");
  process.stdout.write(JSON.stringify({ frames, captures }) + "\n");
} catch (e) {
  if (!(e && e.done)) { console.error(String(e && e.stack || e)); code = 1; }
} finally {
  try { ws.close(); } catch (_) {}
  chrome.kill("SIGKILL");
  setTimeout(() => { try { rmSync(profile, { recursive: true, force: true }); } catch (_) {} process.exit(code); }, 300);
}
