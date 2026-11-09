import { View, div, image } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { exec, run, theme, props, shared, setShared, notify, playSound, openOverlay, closeOverlay, nextCommand } from "herdr";
import { overview, discussions } from "./github.js";
import { readConfig } from "./config.js";
import { strings } from "./i18n.js";
import { demoOverview, demoDiscussions, DEMO_PINS } from "./demo.js";

// The mod's icon, from Herdr's config folder (where the install puts this one).
const ICON = "mods/pr-radar/icon.svg";

// PR Radar: a badge for a status bar that keeps an eye on GitHub for you, through the gh CLI.
// Put it in a layout block (never a window over the layout: an always-open window takes the
// clicks under it). It lives while its layout shows. Every `interval` it posts a Herdr toast when
//   - your review is requested by name (your teams' requests are listed; announced if teamReviews),
//   - the CI of one of your open pull requests fails, or passes after running or failing (greenCi),
//   - a watched branch's checks break or are fixed,
//   - there's new activity in a pull request discussion you take part in (unread notifications).
// Clicking a toast or a row opens it in the browser. The badge opens a panel listing everything.
// Config: the block's props (config.js). Shared "pr-radar.state:<scope>" is what the badge and
// panel show; "pr-radar.seen:<scope>" is what was announced, so a restart doesn't repeat it.
// "pr-radar.pins:<scope>" lists the pinned pull requests: the panel's 📌 toggles them, they're
// shown first and announced loudly, and unpinned once merged or closed.
// The first check only records. props.panel: the panel copy (it reads the badge's props.cfg).
// Commands: pr-radar.refresh, pr-radar.panel, pr-radar.test (a sample toast).

const CI_LOOK = { success: ["✓", "ansi2"], failed: ["✗", "blocked"], pending: ["●", "working"], missing: ["?", "dim"] };
const short = (repo) => repo.split("/").pop();
const ref = (x) => `${short(x.repo)}#${x.number ?? ""}`;
// A pull request's key, "owner/name#123", as pins store it (null for a thread without a number).
const prKey = (x) => (x.number ? `${x.repo}#${x.number}` : null);
const openUrl = (url) => { if (url) exec("open", [url]).catch(() => exec("xdg-open", [url]).catch(() => {})); };

function ago(s, iso) {
  const m = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60000));
  const [mn, h, d] = s.units;
  return m < 1 ? s.now : m < 60 ? `${m} ${mn}` : m < 1440 ? `${Math.round(m / 60)} ${h}` : `${Math.round(m / 1440)} ${d}`;
}

export default class PrRadar extends View {
  init(_props, cx) {
    const p = props() ?? {};
    this.panel = Boolean(p.panel);
    this.cfg = readConfig(this.panel ? p.cfg : p);
    this.s = strings(this.cfg.lang);
    this.stateKey = `pr-radar.state:${this.cfg.id}`;
    this.seenKey = `pr-radar.seen:${this.cfg.id}`;
    this.pinsKey = `pr-radar.pins:${this.cfg.id}`;
    if (this.panel) return;
    this.links = new Map(); this.slot = 0; this.busy = false;
    cx.spawn(async (cx) => {
      for (;;) {
        const c = await nextCommand();
        cx.notify(); // touches this build's cx: after a reload, the old build's loop ends here
        if (c === "refresh") this.refresh(cx);
        else if (c === "panel") this.openPanel();
        else if (c === "test") this.toast(this.s.testTitle, this.s.testBody, "info", `https://${this.cfg.host}/notifications`, true);
        else if (c.startsWith("open-")) openUrl(this.links.get(c.slice(5)));
      }
    });
    cx.timer.every(this.cfg.interval * 1000, (cx) => this.refresh(cx));
    this.refresh(cx);
  }

  // Pinned pull requests' keys, in the order they were pinned. Both copies read and write them.
  pins() {
    const v = shared(this.pinsKey);
    return Array.isArray(v) ? v.filter((k) => typeof k === "string") : [];
  }

  togglePin(key) {
    const pins = this.pins(), on = !pins.includes(key);
    setShared(this.pinsKey, on ? [...pins, key] : pins.filter((k) => k !== key));
    if (on) run("pr-radar.refresh"); // fetch what the pin watches
  }

  openPanel() {
    openOverlay({ mod: "pr-radar", props: { panel: true, cfg: props() ?? {} }, kind: "dialog", width: 680, height: 0.7 });
  }

  // A toast that opens url when clicked (through this copy's "open-<slot>" command).
  toast(title, body, level, url, needsYou = false) {
    const slot = `${Date.now().toString(36)}${++this.slot}`;
    this.links.set(slot, url);
    if (this.links.size > 50) this.links.delete(this.links.keys().next().value);
    try { notify({ title, body, level, timeout: 15000, action: { name: `pr-radar.open-${slot}` } }); } catch { /* no toast mod */ }
    const { sound } = this.cfg;
    if (sound === "always" || (sound === "needs-you" && needsYou)) try { playSound("blocked"); } catch { /* sounds off */ }
  }

  refresh(cx) {
    if (this.busy) return;
    this.busy = true;
    cx.spawn(async (cx) => {
      const prev = shared(this.stateKey) ?? {};
      try {
        if (this.cfg.demo && shared(this.pinsKey) == null) setShared(this.pinsKey, DEMO_PINS);
        const [o, threads] = this.cfg.demo
          ? [demoOverview(this.pins()), demoDiscussions()]
          : await Promise.all([overview(this.cfg, this.pins()), discussions(this.cfg)]);
        if (!this.cfg.demo) this.announce(o, threads);
        setShared(this.stateKey, { ...o, threads, at: Date.now(), error: this.cfg.problems[0] ?? null });
      } catch (e) {
        console.log(`pr-radar: ${e?.message ?? e}`);
        setShared(this.stateKey, { ...prev, error: String(e?.message ?? e), at: Date.now() });
      } finally {
        this.busy = false;
        cx.notify();
      }
    });
  }

  announce(o, threads) {
    const { s, cfg } = this;
    const seen = shared(this.seenKey);
    const first = !seen;
    const next = { reviews: [], prs: {}, branches: {}, threads: {}, pinned: {} };
    // A pinned pull request is loud: everything about it is announced, with the needs-you sound.
    const pinned = new Set(this.pins()), loud = (key) => pinned.has(key);
    const toasted = new Set(); // pull requests already announced this round
    const say = (key, ...args) => { toasted.add(key); this.toast(...args); };

    // Every review request is recorded, announced or not, so pinning one later doesn't announce it.
    for (const r of o.reviews) {
      next.reviews.push(r.key);
      if (r.team && !cfg.teamReviews && !loud(r.key)) continue;
      if (!first && !seen.reviews.includes(r.key)) {
        say(r.key, r.team ? s.teamReviewRequested(ref(r)) : s.reviewRequested(ref(r)), `${r.title} · ${r.author}`, "warning", r.url, !r.team || loud(r.key));
      }
    }

    for (const p of o.prs) {
      const before = seen?.prs?.[p.key];
      next.prs[p.key] = { oid: p.oid, ci: p.ci };
      if (first) continue;
      if (p.ci === "failed" && !(before?.oid === p.oid && before?.ci === "failed")) {
        say(p.key, s.ciFailed(ref(p)), p.title, "error", `${p.url}/checks`, true);
      } else if ((cfg.greenCi || loud(p.key)) && p.ci === "success" && (before?.ci === "pending" || before?.ci === "failed")) {
        say(p.key, s.ciGreen(ref(p)), p.title, "success", p.url, loud(p.key));
      }
    }

    // A branch is announced when its settled state flips (a run in progress changes nothing).
    for (const b of o.branches) {
      const before = seen?.branches?.[b.key] ?? null;
      next.branches[b.key] = before;
      if (b.ci !== "success" && b.ci !== "failed") continue;
      next.branches[b.key] = b.ci;
      if (first || !before || before === b.ci) continue;
      const name = `${short(b.repo)}/${b.branch}`;
      if (b.ci === "failed") this.toast(s.branchBroken(name), s.branchBrokenBody, "error", b.url, true);
      else this.toast(s.branchFixed(name), s.branchFixedBody, "success", b.url);
    }

    for (const th of threads) {
      next.threads[th.id] = th.updated;
      const before = seen?.threads?.[th.id];
      if (!first && (!before || Date.parse(th.updated) > Date.parse(before))) {
        const key = prKey(th);
        say(key, `${s.reasons[th.reason] ?? s.activity}: ${ref(th)}`, th.title, "info", th.url, loud(key));
      }
    }

    // Pinned pull requests: what the lists above don't cover. A merged or closed one is unpinned.
    const mine = new Set(o.prs.map((p) => p.key)), gone = [];
    for (const p of o.pinned ?? []) {
      const before = seen?.pinned?.[p.key];
      if (p.gone) { gone.push(p.key); continue; }
      if (p.unknown) { if (before) next.pinned[p.key] = before; continue; }
      if (p.state !== "open") {
        gone.push(p.key);
        if (!first) say(p.key, p.state === "merged" ? s.merged(ref(p)) : s.closed(ref(p)), p.title, p.state === "merged" ? "success" : "info", p.url, true);
        continue;
      }
      next.pinned[p.key] = { oid: p.oid, ci: p.ci, decision: p.decision, last: p.last?.id ?? null };
      if (first || !before) continue; // just pinned: only record
      const theirs = !mine.has(p.key); // your own pull requests' CI is announced above
      if (theirs && p.ci === "failed" && !(before.oid === p.oid && before.ci === "failed")) {
        say(p.key, s.ciFailed(ref(p)), p.title, "error", `${p.url}/checks`, true);
      } else if (theirs && p.ci === "success" && (before.ci === "pending" || before.ci === "failed")) {
        say(p.key, s.ciGreen(ref(p)), p.title, "success", p.url, true);
      }
      const newComment = p.last && p.last.id !== before.last && p.last.author !== o.me && !p.last.bot;
      if (p.decision !== before.decision && p.decision) {
        say(p.key, p.decision === "approved" ? s.approved(ref(p)) : s.changesRequested(ref(p)), p.title,
          p.decision === "approved" ? "success" : "warning", p.url, true);
      } else if (theirs && p.oid && before.oid && p.oid !== before.oid) {
        say(p.key, s.newCommits(ref(p)), p.title, "info", `${p.url}/commits`, true);
      } else if (newComment && !toasted.has(p.key)) {
        say(p.key, s.newComment(ref(p)), `${p.title} · ${p.last.author}`, "info", p.url, true);
      }
    }
    setShared(this.seenKey, next);
    if (gone.length) setShared(this.pinsKey, this.pins().filter((k) => !gone.includes(k)));
  }

  render() { return this.panel ? this.renderPanel() : this.renderBadge(); }

  // ---- The badge: counts for a status bar; a click opens the panel ----

  renderBadge() {
    const t = theme(), s = this.s;
    const st = shared(this.stateKey) ?? {};
    const reviews = st.reviews ?? [], prs = st.prs ?? [], branches = st.branches ?? [];
    const personal = reviews.filter((r) => !r.team).length, team = reviews.length - personal;
    const failed = prs.filter((p) => p.ci === "failed").length, running = prs.filter((p) => p.ci === "pending").length;
    const threads = (st.threads ?? []).length;
    const worst = ["failed", "missing", "pending", "success"].find((c) => branches.some((b) => b.ci === c));
    const [bIcon, bColor] = CI_LOOK[worst] ?? ["·", "dim"];
    const item = (text, color) => div().text_color(color).child(text);
    // 📌 n: red when a pinned pull request's checks fail, accent when one waits on you.
    const pins = new Set(this.pins());
    const pinFailed = [...(st.pinned ?? []), ...prs].some((p) => pins.has(p.key) && p.ci === "failed");
    const pinWaiting = reviews.some((r) => !r.team && pins.has(r.key)) || (st.threads ?? []).some((th) => pins.has(prKey(th)));

    return h_flex().id("prr-badge").size_full().px(14).gap(12).items_center().justify_end()
      .bg(t.chrome).border_t(1).border_color(t.border).text_size(11.8).text_color(t.muted)
      .cursor_pointer().hover((h) => h.bg(t.hover))
      .on_click(() => this.openPanel())
      .child(image(ICON).w(15).h(15).flex_none())
      .child(div().flex_1())
      .when(!st.at, (e) => e.child(item(s.loading, t.dim)))
      .when(Boolean(st.error), (e) => e.child(item(s.error, t.blocked)))
      .when(Boolean(st.at), (e) => e
        .when(pins.size > 0, (e) => e.child(item(`📌 ${pins.size}`, pinFailed ? t.blocked : pinWaiting ? t.accent : t.muted)))
        .child(item(`◉ ${s.reviews(personal)}${team ? ` (+${team})` : ""}`, personal ? t.accent : t.muted))
        .child(item(failed ? `✗ ${failed} CI` : running ? `● ${running} CI` : "✓ CI", failed ? t.blocked : running ? t.working : t.muted))
        .child(item(`✎ ${threads}`, threads ? t.foreground : t.muted))
        .when(branches.length > 0, (e) => e.child(item(
          `${branches.length === 1 ? branches[0].branch : `${branches.length} branches`} ${bIcon}`, t[bColor]))));
  }

  // ---- The panel: everything that needs you; a click opens it on GitHub ----

  renderPanel() {
    const t = theme(), s = this.s;
    const st = shared(this.stateKey) ?? {};
    const close = () => closeOverlay(props().overlay);
    const pins = this.pins(), pinned = new Set(pins);
    let n = 0;
    // The 📌 at the end of a pull request's row pins or unpins it; the rest of the row opens it.
    // A pinned row always shows it; an unpinned one only while hovered, faint until the pin itself is.
    const pin = (key, rowId) => {
      const on = pinned.has(key), shown = Boolean(key) && (on || this.hoverRow === rowId);
      return h_flex().w(20).flex_none().justify_center()
        .when(shown, (e) => e.id(`${rowId}-pin`).cursor_pointer().text_size(12)
          .opacity(on ? 1 : 0.35).hover((h) => h.opacity(on ? 0.6 : 1))
          .on_click((_e, cx) => { cx.stop_propagation(); this.togglePin(key); })
          .child("📌"));
    };
    const row = (icon, color, where, title, extra, url, key = null) => {
      const id = `prr-row-${n++}`;
      return h_flex().id(id).h(30).flex_none().px(10).gap(10).items_center()
      .rounded(5).cursor_pointer().hover((h) => h.bg(t.hover)).on_click(() => { openUrl(url); close(); })
      .when(Boolean(key), (e) => e.on_hover((hovered, cx) => {
        if (hovered) this.hoverRow = id; else if (this.hoverRow === id) this.hoverRow = null;
        cx.notify();
      }))
      .child(div().w(14).flex_none().text_color(color).child(icon))
      .child(div().w(150).flex_none().truncate().text_size(11.5).text_color(t.dim).child(where))
      .child(div().flex_1().min_w(0).truncate().text_size(12.5).text_color(t.foreground).child(title))
      .child(div().flex_none().text_size(11).text_color(t.dim).child(extra ?? ""))
      .child(pin(key, id));
    };
    const section = (key, rows) => v_flex().gap(2).pt(10)
      .child(div().px(10).pb(4).text_size(10.5).text_color(t.dim).child(s.sections[key].toUpperCase()))
      .when(rows.length === 0, (e) => e.child(div().px(10).text_size(12).text_color(t.dim).child(s.empty[key])))
      .children(rows);
    const look = (c) => CI_LOOK[c] ?? ["·", "dim"];

    // A pinned pull request shows once, in Pinned, with everything the other sections know of it.
    const reviews = st.reviews ?? [], threads = st.threads ?? [];
    const unpinned = (x) => !pinned.has(prKey(x));
    const mine = reviews.filter((r) => !r.team && unpinned(r)), team = reviews.filter((r) => r.team && unpinned(r));
    const prs = (st.prs ?? []).filter(unpinned).sort((a, b) => (b.ci === "failed") - (a.ci === "failed"));
    const pinRows = pins.map((key) => {
      const pr = (st.pinned ?? []).find((p) => p.key === key && p.title) ?? (st.prs ?? []).find((p) => p.key === key);
      const review = reviews.find((r) => r.key === key), thread = threads.find((th) => prKey(th) === key);
      const base = pr ?? review ?? thread;
      return base && { key, base, ci: (pr ?? review)?.ci, draft: (pr ?? review)?.draft, decision: pr?.decision, review, thread };
    }).filter(Boolean).sort((a, b) => (b.ci === "failed") - (a.ci === "failed"));
    const pinRow = (p) => {
      const [ic, col] = p.ci ? look(p.ci) : p.thread ? ["✎", "foreground"] : ["◉", "accent"];
      const bit = (text, color) => div().text_color(color).child(text);
      const notes = h_flex().gap(8)
        .when(Boolean(p.review), (e) => e.child(p.review.team ? bit(`○ ${s.team}`, t.dim) : bit(`◉ ${s.review}`, t.accent)))
        .when(Boolean(p.decision), (e) => e.child(bit(s.decision[p.decision], p.decision === "approved" ? t.ansi2 : t.blocked)))
        .when(Boolean(p.thread), (e) => e.child(bit(`✎ ${p.thread && ago(s, p.thread.updated)}`, t.foreground)))
        .when(Boolean(p.draft), (e) => e.child(bit(s.draft, t.dim)));
      const url = p.ci === "failed" ? `${p.base.url}/checks` : p.base.url;
      return row(ic, t[col], ref(p.base), p.base.title, notes, url, p.key);
    };

    return v_flex().size_full().bg(t.background)
      .child(h_flex().px(16).py(12).gap(10).items_center().border_b(1).border_color(t.border)
        .child(image(ICON).w(20).h(20).flex_none())
        .child(div().text_size(14).font_semibold().text_color(t.foreground).child(s.title))
        .child(div().text_size(11).text_color(t.dim).child(st.at ? s.updated(ago(s, new Date(st.at).toISOString())) : s.waiting))
        .child(div().flex_1())
        .child(div().id("prr-refresh").px(8).py(2).rounded(5).border_1().border_color(t.border).text_size(11.5).cursor_pointer()
          .hover((h) => h.bg(t.hover)).on_click(() => run("pr-radar.refresh")).child(s.refresh)))
      .when(Boolean(st.error), (e) => e.child(div().px(16).py(8).text_size(12).text_color(t.blocked).child(st.error)))
      .child(v_flex().flex_1().min_h(0).px(6).pb(10).overflow_y_scrollbar()
        .when(pinRows.length > 0, (e) => e.child(section("pinned", pinRows.map(pinRow))))
        .child(section("reviews", mine.map((r) => row("◉", t.accent, ref(r), r.title, r.author, r.url, r.key))))
        .child(section("ci", prs.map((p) => {
          const [ic, col] = look(p.ci);
          return row(ic, t[col], ref(p), p.title, p.draft ? s.draft : "", p.ci === "failed" ? `${p.url}/checks` : p.url, p.key);
        })))
        .when((st.branches ?? []).length > 0, (e) => e.child(section("branches", st.branches.map((b) => {
          const [ic, col] = look(b.ci);
          return row(ic, t[col], `${short(b.repo)}/${b.branch}`, s.ci[b.ci ?? "none"], b.oid?.slice(0, 7), b.url);
        }))))
        .child(section("discussions", threads.filter(unpinned).map((th) => row("✎", t.foreground, ref(th), th.title,
          `${s.reasons[th.reason] ?? th.reason} · ${ago(s, th.updated)}`, th.url, prKey(th)))))
        .child(section("team", team.map((r) => row("○", t.dim, ref(r), r.title, `${s.team} · ${r.author}`, r.url, r.key)))));
  }
}
