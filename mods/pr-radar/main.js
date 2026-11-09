import { View, div } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { exec, run, theme, props, shared, setShared, notify, playSound, openOverlay, closeOverlay, nextCommand } from "herdr";
import { overview, discussions } from "./github.js";
import { readConfig } from "./config.js";
import { strings } from "./i18n.js";
import { demoOverview, demoDiscussions } from "./demo.js";

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
// The first check only records. props.panel: the panel copy (it reads the badge's props.cfg).
// Commands: pr-radar.refresh, pr-radar.panel, pr-radar.test (a sample toast).

const CI_LOOK = { success: ["✓", "ansi2"], failed: ["✗", "blocked"], pending: ["●", "working"], missing: ["?", "dim"] };
const short = (repo) => repo.split("/").pop();
const ref = (x) => `${short(x.repo)}#${x.number ?? ""}`;
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
        const [o, threads] = this.cfg.demo
          ? [demoOverview(), demoDiscussions()]
          : await Promise.all([overview(this.cfg), discussions(this.cfg)]);
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
    const next = { reviews: [], prs: {}, branches: {}, threads: {} };

    for (const r of o.reviews) {
      if (r.team && !cfg.teamReviews) continue;
      next.reviews.push(r.key);
      if (!first && !seen.reviews.includes(r.key)) {
        this.toast(r.team ? s.teamReviewRequested(ref(r)) : s.reviewRequested(ref(r)), `${r.title} · ${r.author}`, "warning", r.url, !r.team);
      }
    }

    for (const p of o.prs) {
      const before = seen?.prs?.[p.key];
      next.prs[p.key] = { oid: p.oid, ci: p.ci };
      if (first) continue;
      if (p.ci === "failed" && !(before?.oid === p.oid && before?.ci === "failed")) {
        this.toast(s.ciFailed(ref(p)), p.title, "error", `${p.url}/checks`, true);
      } else if (cfg.greenCi && p.ci === "success" && (before?.ci === "pending" || before?.ci === "failed")) {
        this.toast(s.ciGreen(ref(p)), p.title, "success", p.url);
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
        this.toast(`${s.reasons[th.reason] ?? s.activity}: ${ref(th)}`, th.title, "info", th.url);
      }
    }
    setShared(this.seenKey, next);
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

    return h_flex().id("prr-badge").size_full().px(14).gap(12).items_center().justify_end()
      .bg(t.chrome).border_t(1).border_color(t.border).text_size(11.8).text_color(t.muted)
      .cursor_pointer().hover((h) => h.bg(t.hover))
      .on_click(() => this.openPanel())
      .when(!st.at, (e) => e.child(item(s.loading, t.dim)))
      .when(Boolean(st.error), (e) => e.child(item(s.error, t.blocked)))
      .when(Boolean(st.at), (e) => e
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
    let n = 0;
    const row = (icon, color, where, title, extra, url) => h_flex().id(`prr-row-${n++}`).h(30).flex_none().px(10).gap(10).items_center()
      .rounded(5).cursor_pointer().hover((h) => h.bg(t.hover)).on_click(() => { openUrl(url); close(); })
      .child(div().w(14).flex_none().text_color(color).child(icon))
      .child(div().w(150).flex_none().truncate().text_size(11.5).text_color(t.dim).child(where))
      .child(div().flex_1().min_w(0).truncate().text_size(12.5).text_color(t.foreground).child(title))
      .child(div().flex_none().text_size(11).text_color(t.dim).child(extra ?? ""));
    const section = (key, rows) => v_flex().gap(2).pt(10)
      .child(div().px(10).pb(4).text_size(10.5).text_color(t.dim).child(s.sections[key].toUpperCase()))
      .when(rows.length === 0, (e) => e.child(div().px(10).text_size(12).text_color(t.dim).child(s.empty[key])))
      .children(rows);
    const look = (c) => CI_LOOK[c] ?? ["·", "dim"];

    const reviews = st.reviews ?? [];
    const mine = reviews.filter((r) => !r.team), team = reviews.filter((r) => r.team);
    const prs = (st.prs ?? []).slice().sort((a, b) => (b.ci === "failed") - (a.ci === "failed"));

    return v_flex().size_full().bg(t.background)
      .child(h_flex().px(16).py(12).gap(10).items_center().border_b(1).border_color(t.border)
        .child(div().text_size(14).font_semibold().text_color(t.foreground).child(s.title))
        .child(div().text_size(11).text_color(t.dim).child(st.at ? s.updated(ago(s, new Date(st.at).toISOString())) : s.waiting))
        .child(div().flex_1())
        .child(div().id("prr-refresh").px(8).py(2).rounded(5).border_1().border_color(t.border).text_size(11.5).cursor_pointer()
          .hover((h) => h.bg(t.hover)).on_click(() => run("pr-radar.refresh")).child(s.refresh)))
      .when(Boolean(st.error), (e) => e.child(div().px(16).py(8).text_size(12).text_color(t.blocked).child(st.error)))
      .child(v_flex().flex_1().min_h(0).px(6).pb(10).overflow_y_scrollbar()
        .child(section("reviews", mine.map((r) => row("◉", t.accent, ref(r), r.title, r.author, r.url))))
        .child(section("ci", prs.map((p) => {
          const [ic, col] = look(p.ci);
          return row(ic, t[col], ref(p), p.title, p.draft ? s.draft : "", p.ci === "failed" ? `${p.url}/checks` : p.url);
        })))
        .when((st.branches ?? []).length > 0, (e) => e.child(section("branches", st.branches.map((b) => {
          const [ic, col] = look(b.ci);
          return row(ic, t[col], `${short(b.repo)}/${b.branch}`, s.ci[b.ci ?? "none"], b.oid?.slice(0, 7), b.url);
        }))))
        .child(section("discussions", (st.threads ?? []).map((th) => row("✎", t.foreground, ref(th), th.title,
          `${s.reasons[th.reason] ?? th.reason} · ${ago(s, th.updated)}`, th.url))))
        .child(section("team", team.map((r) => row("○", t.dim, ref(r), r.title, `${s.team} · ${r.author}`, r.url)))));
  }
}
