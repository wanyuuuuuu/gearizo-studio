/* Gearizo content studio runtime.
   Gives app.js the same window.claude.use("db" | "user" | "assets" | "downloads") API it had
   as a claude.ai artifact, backed by Supabase: login, live JSON documents, private file storage. */
(function () {
  "use strict";
  const cfg = window.GZ_CONFIG || {};
  const $ = (id) => document.getElementById(id);
  let authMode = "in";
  if (!cfg.supabaseUrl || !cfg.supabaseAnonKey || /YOUR_/.test(cfg.supabaseUrl)) {
    document.addEventListener("DOMContentLoaded", () => showAuth("setup"));
    return;
  }
  const sb = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
  });
  window.gzSupabase = sb;
  let session = null, started = false, resolveReady;
  const ready = new Promise((r) => (resolveReady = r));

  /* ---------- live collections ---------- */
  const cols = new Map();
  const col = (name) => {
    if (!cols.has(name)) cols.set(name, { docs: new Map(), listeners: new Set(), loaded: false, loading: null });
    return cols.get(name);
  };
  const snapOf = (c) => ({ docs: [...c.docs.entries()].map(([id, data]) => ({ id, exists: true, data: () => data })) });
  const emit = (c) => { const s = snapOf(c); c.listeners.forEach((l) => { try { l.next(s); } catch (e) { console.error(e); } }); };
  function load(name) {
    const c = col(name);
    if (c.loading) return c.loading;
    c.loading = (async () => {
      const rows = [];
      for (let from = 0; ; from += 1000) {
        const { data, error } = await sb.from("docs").select("id,data").eq("collection", name).range(from, from + 999);
        if (error) { c.loading = null; throw error; }
        rows.push(...data);
        if (data.length < 1000) break;
      }
      c.docs = new Map(rows.map((r) => [r.id, r.data]));
      c.loaded = true;
      emit(c);
    })();
    return c.loading;
  }
  function startRealtime() {
    sb.channel("docs-all")
      .on("postgres_changes", { event: "*", schema: "public", table: "docs" }, (p) => {
        const rec = p.new && p.new.collection ? p.new : p.old;
        if (!rec || !rec.collection) return;
        const c = cols.get(rec.collection);
        if (!c || !c.loaded) return;
        if (p.eventType === "DELETE") c.docs.delete(rec.id); else c.docs.set(rec.id, p.new.data);
        emit(c);
      })
      .subscribe((status) => {
        if (status === "SUBSCRIBED") cols.forEach((c, name) => { if (c.loaded) { c.loading = null; load(name).catch(() => {}); } });
      });
    // Coming back to the app after the phone slept: refresh everything once
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") cols.forEach((c, name) => { if (c.loaded) { c.loading = null; load(name).catch(() => {}); } });
    });
  }
  const newId = () => {
    const a = "abcdefghijklmnopqrstuvwxyz0123456789", r = crypto.getRandomValues(new Uint8Array(20));
    let s = ""; for (const b of r) s += a[b % 36]; return s;
  };
  const wrapErr = (e) => {
    const x = new Error((e && e.message) || "error");
    x.code = e && (e.code === "42501" || /row-level security|permission|not allowed/i.test(e.message || "")) ? "not_granted" : "store_unavailable";
    return x;
  };
  const plain = (d) => JSON.parse(JSON.stringify(d || {}));
  function docRef(name, id) {
    return {
      id,
      async get() {
        const c = col(name);
        if (c.loaded && c.docs.has(id)) return { id, exists: true, data: () => c.docs.get(id) };
        const { data, error } = await sb.from("docs").select("data").eq("collection", name).eq("id", id).maybeSingle();
        if (error) throw wrapErr(error);
        return { id, exists: !!data, data: () => (data ? data.data : undefined) };
      },
      async set(d) {
        const c = col(name), clean = plain(d);
        if (c.loaded) { c.docs.set(id, clean); emit(c); }
        const { error } = await sb.from("docs").upsert({ collection: name, id, data: clean });
        if (error) throw wrapErr(error);
      },
      async update(patch) {
        const c = col(name), clean = plain(patch);
        if (c.loaded && c.docs.has(id)) { c.docs.set(id, { ...c.docs.get(id), ...clean }); emit(c); }
        const { error } = await sb.rpc("doc_merge", { c: name, i: id, patch: clean });
        if (error) throw wrapErr(error);
      },
      async delete() {
        const c = col(name);
        if (c.loaded) { c.docs.delete(id); emit(c); }
        const { error } = await sb.from("docs").delete().eq("collection", name).eq("id", id);
        if (error) throw wrapErr(error);
      },
    };
  }
  /* Roles live in public.members (only the owner edits them). app.js still reads them as a "team" collection. */
  const teamListeners = new Set();
  let teamSnap = null, member = { role: "", is_owner: false };
  async function loadTeam() {
    const { data, error } = await sb.rpc("team_roles");
    if (error) throw error;
    teamSnap = { docs: (data || []).map((r) => ({ id: r.user_id, exists: true, data: () => ({ role: r.role }) })) };
    teamListeners.forEach((l) => { try { l.next(teamSnap); } catch (e) { console.error(e); } });
  }
  async function loadMember() {
    const { data } = await sb.rpc("my_member");
    member = (data && data[0]) || { role: "", is_owner: false };
  }
  const teamCollection = {
    doc: () => ({ get: async () => ({ exists: false, data: () => undefined }), set: async () => { const e = new Error("Roles are set by the studio owner"); e.code = "not_granted"; throw e; }, update: async () => {}, delete: async () => {} }),
    add: async () => { const e = new Error("Roles are set by the studio owner"); e.code = "not_granted"; throw e; },
    onSnapshot(next, error) {
      const l = { next, error }; teamListeners.add(l);
      if (teamSnap) setTimeout(() => next(teamSnap), 0); else loadTeam().catch((e) => error && error(wrapErr(e)));
      return () => teamListeners.delete(l);
    },
  };
  /* Owner tools for the Team screen */
  window.gzTeam = {
    async list() {
      const { data, error } = await sb.from("members").select("email,role,is_owner,added_at").order("added_at");
      if (error) throw error;
      return data || [];
    },
    async add(email, role) {
      const { error } = await sb.from("members").insert({ email: String(email).trim().toLowerCase(), role });
      if (error) throw error;
      await loadTeam();
    },
    async setRole(email, role) {
      const { error } = await sb.from("members").update({ role }).eq("email", email);
      if (error) throw error;
      await loadTeam();
    },
    async remove(email) {
      const { error } = await sb.from("members").delete().eq("email", email);
      if (error) throw error;
      await loadTeam();
    },
    me: () => ({ ...member }),
  };
  /* Each person's private Google Calendar link (only they can read it) and their shoot feed */
  /* Facebook & Instagram connection for auto-posting (marketing or the owner connects it) */
  window.gzMeta = {
    async call(action, extra) {
      const { data, error } = await sb.functions.invoke("notify", { body: Object.assign({ action }, extra || {}) });
      if (error) { let msg = error.message; try { const j = await error.context.json(); if (j && j.error) msg = j.error; } catch (e) {} throw new Error(msg); }
      if (data && data.error) throw new Error(data.error);
      return data;
    },
    status() { return this.call("meta_status"); },
    check() { return this.call("meta_check"); },
    disconnect() { return this.call("meta_disconnect"); },
    async start(appId, appSecret) {
      const r = await this.call("meta_start", { app_id: appId || "", app_secret: appSecret || "", return_url: location.origin + location.pathname });
      location.href = r.url;
    },
  };
  window.gzCal = {
    async get() {
      const { data } = await sb.from("calendar_links").select("ics_url,feed_token,last_sync,last_error").eq("user_id", session.user.id).maybeSingle();
      if (!data) return { connected: false, feedUrl: null };
      return { connected: !!data.ics_url, feedUrl: cfg.supabaseUrl + "/functions/v1/notify?feed=" + data.feed_token, lastSync: data.last_sync, error: data.last_error };
    },
    async ensure() {
      const { data } = await sb.from("calendar_links").select("user_id").eq("user_id", session.user.id).maybeSingle();
      if (!data) { const { error } = await sb.from("calendar_links").insert({ user_id: session.user.id }); if (error) throw error; }
    },
    async save(url) {
      const { error } = await sb.from("calendar_links").upsert({ user_id: session.user.id, ics_url: url || null, updated_at: new Date().toISOString() });
      if (error) throw error;
      return this.sync();
    },
    async sync() {
      const { data, error } = await sb.functions.invoke("notify", { body: { action: "calsync" } });
      if (error) throw error;
      return data;
    },
  };

  const db = {
    collection(name) {
      if (name === "team") return teamCollection;
      return {
        doc: (id) => docRef(name, id || newId()),
        async add(d) { const r = docRef(name, newId()); await r.set(d); return r; },
        onSnapshot(next, error) {
          const c = col(name), l = { next, error };
          c.listeners.add(l);
          if (c.loaded) setTimeout(() => next(snapOf(c)), 0);
          else load(name).catch((e) => { if (error) error(wrapErr(e)); });
          return () => c.listeners.delete(l);
        },
      };
    },
  };

  /* ---------- people ---------- */
  const user = {
    id: async () => session.user.id,
    isOwner: async () => {
      if (member.is_owner) return true;
      const bytes = new TextEncoder().encode((session.user.email || "").trim().toLowerCase());
      const hash = [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map((b) => b.toString(16).padStart(2, "0")).join("");
      return hash === cfg.ownerEmailSha256;
    },
    can: async () => true,
    async profiles(ids) {
      const c = col("profiles");
      if (!c.loaded) await load("profiles").catch(() => {});
      const out = {};
      ids.forEach((id) => { const p = c.docs.get(id); out[id] = { name: (p && p.name) || "" }; });
      return out;
    },
    me: async () => ({ id: session.user.id, name: displayName() }),
  };
  const displayName = () => {
    const m = (session && session.user.user_metadata) || {};
    return m.name || (session && session.user.email ? session.user.email.split("@")[0] : "");
  };

  /* ---------- files (private bucket, shown through short-lived signed links) ---------- */
  const assets = {
    async upload(file, opt) {
      const type = (opt && opt.type) || file.type || "application/octet-stream";
      const id = crypto.randomUUID().replace(/-/g, "");
      const { error } = await sb.storage.from("media").upload(id, file, { contentType: type, upsert: false });
      if (error) {
        const e = new Error(error.message);
        e.code = /size|large|exceed/i.test(error.message) ? "too_large" : /mime|type/i.test(error.message) ? "unsupported_type" : /row-level|policy|permission/i.test(error.message) ? "not_granted" : "upstream_error";
        throw e;
      }
      return { id, url: "/_blob/" + id, contentType: type, sizeBytes: file.size };
    },
    async delete(ref) {
      const id = blobId(String(ref)) || String(ref);
      const { error } = await sb.storage.from("media").remove([id]);
      if (error) throw error;
      return { deleted: true };
    },
    async list() { return { assets: [], usage: {} }; },
  };
  const signed = new Map();
  const BLOB_RE = /\/_blob\/([A-Za-z0-9_-]{8,64})/;
  const blobId = (v) => { const m = BLOB_RE.exec(v || ""); return m && m[1]; };
  async function signIds(ids, force) {
    const need = [...new Set(ids)].filter((id) => { const s = signed.get(id); return force || !s || s.exp < Date.now() + 60000; });
    if (!need.length) return;
    const { data, error } = await sb.storage.from("media").createSignedUrls(need, 3600);
    if (error || !data) return;
    data.forEach((d) => { if (d.signedUrl && d.path) signed.set(d.path, { url: d.signedUrl, exp: Date.now() + 3500 * 1000 }); });
  }
  const pending = new Set(); let flushT = null;
  function claim(el) {
    if (!el.getAttribute) return;
    for (const attr of ["src", "href"]) {
      const v = el.getAttribute(attr), id = blobId(v);
      if (!id) continue;
      el.dataset.blob = id; el.dataset.blobAttr = attr;
      if (el.tagName === "VIDEO" || el.tagName === "IMG") el.crossOrigin = "anonymous";
      el.removeAttribute(attr);
      pending.add(el);
    }
  }
  function scan(root) {
    if (root.nodeType !== 1) return;
    claim(root);
    root.querySelectorAll('[src*="/_blob/"],[href*="/_blob/"]').forEach(claim);
  }
  function flush(force) {
    clearTimeout(flushT);
    flushT = setTimeout(async () => {
      const els = [...pending]; pending.clear();
      await signIds(els.map((e) => e.dataset.blob), force);
      els.forEach((el) => { const s = signed.get(el.dataset.blob); if (s) el.setAttribute(el.dataset.blobAttr, s.url); });
    }, 0);
  }
  new MutationObserver((muts) => {
    for (const m of muts) {
      if (m.type === "childList") m.addedNodes.forEach(scan); else claim(m.target);
    }
    if (pending.size) flush(false);
  }).observe(document.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: ["src", "href"] });
  // An expired link: sign again
  document.addEventListener("error", (e) => {
    const el = e.target;
    if (el && el.dataset && el.dataset.blob && !el.dataset.retried) { el.dataset.retried = "1"; pending.add(el); flush(true); }
  }, true);
  const _fetch = window.fetch.bind(window);
  window.fetch = async (input, init) => {
    const u = typeof input === "string" ? input : input && input.url, id = blobId(u);
    if (id) { await signIds([id]); const s = signed.get(id); if (s) return _fetch(s.url, init); }
    return _fetch(input, init);
  };

  /* ---------- saving a file to the device ---------- */
  const downloads = {
    async save({ filename, data }) {
      const blob = data instanceof Blob ? data : new Blob([data]);
      const url = URL.createObjectURL(blob), a = document.createElement("a");
      a.href = url; a.download = filename || "file"; document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 30000);
      return { status: "saved" };
    },
  };

  window.claude = {
    async use(name) {
      await ready;
      return { db, user, assets, downloads }[name] || null;
    },
  };

  /* ---------- sign-in screen ---------- */
  function showAuth(mode, msg) {
    const box = $("gzAuth"); if (!box) return;
    box.hidden = false; authMode = mode || authMode;
    const f = $("gzAuthForm");
    $("gzName").parentElement.hidden = authMode !== "up";
    $("gzPass").parentElement.hidden = authMode === "reset";
    $("gzEmail").parentElement.hidden = authMode === "newpass";
    $("gzAuthGo").textContent = { in: "Sign in", up: "Create account", reset: "Send reset link", newpass: "Save new password", setup: "" }[authMode] || "Sign in";
    $("gzAuthTitle").textContent = { in: "Sign in", up: "Create your account", reset: "Reset password", newpass: "Choose a new password", setup: "Almost there" }[authMode];
    $("gzSwitch").hidden = authMode === "newpass" || authMode === "setup";
    $("gzSwitch").textContent = authMode === "up" ? "I already have an account" : "Create an account";
    $("gzForgot").hidden = authMode !== "in";
    f.hidden = authMode === "setup";
    $("gzAuthMsg").textContent = msg || (authMode === "setup" ? "The app isn't connected to its database yet." : "");
  }
  async function afterLogin(s) {
    session = s;
    $("gzAuth").hidden = true;
    const { data: member } = await sb.rpc("is_member");
    if (!member) {
      showAuth("in", "Signed in as " + s.user.email + ", but this email isn't on the Gearizo team yet. Ask the studio owner to add it, then sign in again.");
      await sb.auth.signOut();
      return;
    }
    if (started) return;
    started = true;
    // Keep each person's display name where teammates can read it
    docRef("profiles", s.user.id).set({ name: displayName(), email: s.user.email }).catch(() => {});
    load("profiles").catch(() => {});
    await loadMember().catch(() => {});
    loadTeam().catch(() => {});
    document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") { loadMember().catch(() => {}); loadTeam().catch(() => {}); } });
    startRealtime();
    resolveReady();
    const app = document.createElement("script");
    app.src = "app.js?v=" + (cfg.version || "1");
    document.body.appendChild(app);
    if (window.gzPush) window.gzPush.init(sb, s);
  }
  document.addEventListener("DOMContentLoaded", () => {
    $("gzSwitch").onclick = () => showAuth(authMode === "up" ? "in" : "up");
    $("gzForgot").onclick = () => showAuth("reset");
    $("gzAuthForm").addEventListener("submit", async (e) => {
      e.preventDefault();
      const email = $("gzEmail").value.trim(), pass = $("gzPass").value, name = $("gzName").value.trim();
      const btn = $("gzAuthGo"); btn.disabled = true;
      try {
        if (authMode === "in") {
          const { data, error } = await sb.auth.signInWithPassword({ email, password: pass });
          if (error) throw error;
          await afterLogin(data.session);
        } else if (authMode === "up") {
          if (!name) { showAuth("up", "Add your name so teammates know who wrote what."); return; }
          const { data, error } = await sb.auth.signUp({ email, password: pass, options: { data: { name }, emailRedirectTo: location.origin + location.pathname } });
          if (error) throw error;
          if (data.session) await afterLogin(data.session);
          else showAuth("in", "Check " + email + " for a confirmation link, then come back and sign in.");
        } else if (authMode === "reset") {
          const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin + location.pathname });
          if (error) throw error;
          showAuth("in", "If " + email + " has an account, a reset link is on its way.");
        } else if (authMode === "newpass") {
          const { error } = await sb.auth.updateUser({ password: pass });
          if (error) throw error;
          const { data } = await sb.auth.getSession();
          await afterLogin(data.session);
        }
      } catch (err) {
        $("gzAuthMsg").textContent = /invalid login/i.test(err.message) ? "Email or password is wrong." : /password/i.test(err.message) && authMode !== "in" ? "Use a password of at least 6 characters." : err.message;
      } finally { btn.disabled = false; }
    });
    sb.auth.onAuthStateChange((event, s) => {
      if (event === "PASSWORD_RECOVERY") { session = s; showAuth("newpass", "Enter a new password for " + s.user.email + "."); return; }
      if (event === "SIGNED_OUT") { if (started) location.reload(); }
    });
    sb.auth.getSession().then(({ data }) => {
      if (/type=recovery/.test(location.hash)) return; // handled by PASSWORD_RECOVERY
      if (data.session) afterLogin(data.session); else showAuth("in");
    });
  });
  window.gzSignOut = () => sb.auth.signOut();
})();
