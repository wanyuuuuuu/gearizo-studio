/* Gearizo: the bell button. Turns phone / computer notifications on for this device. */
window.gzPush = (function () {
  "use strict";
  const cfg = window.GZ_CONFIG || {};
  let sb = null;
  const $ = (id) => document.getElementById(id);
  const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const installed = () => matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
  const supported = () => "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
  const toU8 = (b64) => {
    const s = atob((b64 + "=".repeat((4 - (b64.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/"));
    return Uint8Array.from(s, (c) => c.charCodeAt(0));
  };
  function say(msg) {
    const t = $("toast");
    if (!t) return alert(msg);
    t.textContent = msg; t.classList.add("show");
    clearTimeout(say.t); say.t = setTimeout(() => t.classList.remove("show"), 6000);
  }
  async function current() {
    if (!supported()) return isIOS && !installed() ? "install" : "unsupported";
    if (Notification.permission === "denied") return "denied";
    const reg = await navigator.serviceWorker.ready;
    return (await reg.pushManager.getSubscription()) ? "on" : "off";
  }
  async function save(sub) {
    const j = sub.toJSON();
    const { error } = await sb.from("push_subs").upsert({ endpoint: j.endpoint, sub: j });
    if (error) throw error;
  }
  async function turnOn() {
    if (Notification.permission !== "granted" && (await Notification.requestPermission()) !== "granted") return "denied";
    const reg = await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();
    if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: toU8(cfg.vapidPublicKey) });
    await save(sub);
    return "on";
  }
  async function turnOff() {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (sub) { await sb.from("push_subs").delete().eq("endpoint", sub.endpoint); await sub.unsubscribe(); }
    return "off";
  }
  function paint(state) {
    const b = $("gzBell"); if (!b) return;
    b.hidden = false;
    b.dataset.state = state;
    b.title = state === "on" ? "Alerts are on for this device. Tap to turn off." : "Turn on alerts for this device";
    b.setAttribute("aria-label", b.title);
    b.setAttribute("aria-pressed", state === "on");
  }
  async function click() {
    const b = $("gzBell"); b.disabled = true;
    try {
      const s = await current();
      if (s === "install") return say("On iPhone: tap Share, then Add to Home Screen. Open Gearizo from the Home Screen and tap the bell there.");
      if (s === "unsupported") return say("This browser can't show notifications. Try Chrome, Edge or Safari.");
      if (s === "denied") return say("Notifications are blocked for Gearizo. Allow them in your browser or phone settings, then tap the bell again.");
      if (s === "on") { paint(await turnOff()); return say("Alerts are off on this device."); }
      const r = await turnOn();
      paint(r);
      say(r === "on" ? "Alerts are on. You'll get new tasks, feedback and reviews here." : "Notifications weren't allowed.");
    } catch (e) {
      say("Couldn't turn on alerts: " + e.message);
    } finally { b.disabled = false; }
  }
  return {
    async init(client) {
      sb = client;
      const b = $("gzBell"); if (!b) return;
      b.onclick = click;
      try {
        const s = await current();
        paint(s);
        // Keep this device's subscription fresh on every launch
        if (s === "on") { const reg = await navigator.serviceWorker.ready; save(await reg.pushManager.getSubscription()).catch(() => {}); }
      } catch (e) { paint("off"); }
    },
  };
})();
