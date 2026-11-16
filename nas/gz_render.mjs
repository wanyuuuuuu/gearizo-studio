// Gearizo: capture the text/image layers of an editable video as transparent PNG frames, using Chrome headless.
// Usage: node gz_render.mjs <job.json> <outDir> <gzlayers.js> [chrome path]
// job.json is the edit doc with each image layer's src.file set to a local file path.
// Writes <outDir>/f00001.png ... and <outDir>/layers.ffconcat (each frame held until the next change), and prints
// {"frames":N,"captures":M} on stdout. Stickers are left out: gz_edit.py overlays those clips with ffmpeg.
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const [jobPath, outDir, gzlPath, chromeArg] = process.argv.slice(2);
const doc = JSON.parse(readFileSync(jobPath, "utf8"));
const W = Math.round(doc.w), H = Math.round(doc.h), DUR = Number(doc.dur), FPS = Number(doc.fps) || 30;
if (!(W > 0 && H > 0 && DUR > 0)) { console.error("job needs w, h and dur"); process.exit(2); }
const CHROME = [chromeArg, "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/usr/bin/google-chrome", "/usr/bin/chromium"].find((p) => p && existsSync(p));
if (!CHROME) { console.error("Google Chrome not found"); process.exit(2); }

const html = `<!doctype html><html><head><meta charset="utf-8">
<link rel="stylesheet" href="${(globalThis.GZL_FONTS || "")}">
<style>html,body{margin:0;padding:0;background:transparent;width:${W}px;height:${H}px;overflow:hidden}#s{position:relative;width:${W}px;height:${H}px;overflow:hidden}</style>
<script src="${pathToFileURL(gzlPath).href}"></script></head><body><div id="s"></div>
<script>document.head.querySelector('link').href=GZL.fontsHref();window.DOC=${JSON.stringify(doc).replace(/</g, "\\u003c")};</script></body></html>`;
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
  await ev(`(async()=>{const s=document.getElementById('s');GZL.render(s,DOC,0,{render:true,local:true,all:true});
    await document.fonts.ready;await Promise.all([...document.images].map(i=>i.decode().catch(()=>{})));
    await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));return document.fonts.size})()`);
  const times = await ev(`GZL.captureTimes(DOC,${FPS})`);
  const list = ["ffconcat version 1.0"];
  let prevKey = null, prevFile = null, captures = 0, frames = 0;
  for (let i = 0; i < times.length; i++) {
    const t = times[i], next = i + 1 < times.length ? times[i + 1] : DUR;
    const key = await ev(`GZL.render(document.getElementById('s'),DOC,${t},{render:true,local:true})`);
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
  console.error(String(e && e.stack || e)); code = 1;
} finally {
  try { ws.close(); } catch (_) {}
  chrome.kill("SIGKILL");
  setTimeout(() => { try { rmSync(profile, { recursive: true, force: true }); } catch (_) {} process.exit(code); }, 300);
}
