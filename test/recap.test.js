import { test } from "node:test";
import assert from "node:assert/strict";
import { story, plainRecap, nextRecaps, nextTeams, RECAP_FETCH, RECAP_STALE, TEAMS_STALE } from "../mods/pr-radar/recap.js";
import { strings } from "../mods/pr-radar/i18n.js";

// Fixtures in the shape github.js gives: a pull request with its details (GraphQL's own nodes).
const user = (login) => ({ login, __typename: "User" });
const bot = (login) => ({ login, __typename: "Bot" });
const REVIEWED_AT = "2026-03-02T00:00:00Z", BEFORE = "2026-03-01T00:00:00Z", AFTER = "2026-03-03T00:00:00Z";
const commit = (oid, authoredDate = BEFORE, parents = 1) => ({ oid, authoredDate, parents: { totalCount: parents } });
const review = (login, state, oid = "head", teams = []) => ({ submittedAt: REVIEWED_AT,
  author: login.endsWith("[bot]") ? bot(login) : user(login), state, commit: { oid },
  onBehalfOf: { nodes: teams.map((slug) => ({ slug })) },
});
const thread = (starter, last, isResolved = false, { outdated = false, at, text } = {}) => ({
  isResolved, isOutdated: outdated, first: { nodes: [{ author: user(starter) }] },
  last: { nodes: [{ createdAt: at, bodyText: text, author: last.endsWith("[bot]") ? bot(last) : user(last) }] },
});
const pr = ({ author = "ana", requested = [], opinions = [], latest = opinions, threads = [], total, commits = [], ...rest } = {}) => ({
  author, draft: false, ci: "success", oid: "head", mergeable: "MERGEABLE", mergeState: "BLOCKED", base: "main",
  reviewRequests: { nodes: requested.map((r) => ({ requestedReviewer: r.startsWith("@") ? { __typename: "Team", slug: r.slice(1) } : user(r) })) },
  latestOpinionatedReviews: { nodes: opinions },
  latestReviews: { nodes: latest },
  reviewThreads: { totalCount: total ?? threads.length, nodes: threads },
  commits: { nodes: commits.map((c) => ({ commit: c })) },
  ...rest,
});
const en = strings("en"), fr = strings("fr");
const recap = (p, me = "me", s = en) => plainRecap(story(p, me), s);

test("an approval on behalf of a team, another team still requested", () => {
  const p = pr({ requested: ["@beta"], opinions: [review("bill", "APPROVED", "head", ["alpha"])] });
  const st = story(p, "me");
  assert.deepEqual(st.approvals, [{ by: "bill", teams: ["alpha"] }]);
  assert.deepEqual(st.waitingOn, { users: [], teams: ["beta"] });
  assert.equal(plainRecap(st, en), "waiting on team beta · bill approved for team alpha");
});

test("several approvals list their teams", () => {
  const p = pr({ opinions: [review("bill", "APPROVED", "head", ["alpha"]), review("maya", "APPROVED")] });
  assert.equal(recap(p), "approved by bill (alpha) and maya");
});

test("the author answered the threads you opened, and pushed since your review", () => {
  const p = pr({ latest: [review("me", "COMMENTED", "old")], commits: [commit("old"), commit("head", AFTER)],
    threads: [thread("me", "ana"), thread("me", "ana"), thread("me", "me"), thread("leo", "ana")] });
  const st = story(p, "me");
  assert.equal(st.threads.answered, 2);
  assert.equal(st.sinceMyReview, "pushed");
  assert.equal(plainRecap(st, en), "ana answered your 2 threads · pushed since your review");
});

test("nothing new since your review", () => {
  const p = pr({ latest: [review("me", "COMMENTED", "head")], threads: [thread("me", "me")] });
  assert.equal(story(p, "me").sinceMyReview, "nothing");
  assert.equal(recap(p), "nothing new since your review");
});

test("never reviewed: nothing is said about since your review", () => {
  const p = pr({ requested: ["me"] });
  assert.equal(story(p, "me").sinceMyReview, null);
  assert.equal(recap(p), "waiting on you");
});

test("a review asked of you is never 'no reviewers yet'", () => {
  assert.equal(recap(pr({ requested: ["@planning", "me"] })), "waiting on team planning and you");
  assert.equal(recap(pr({ requested: ["me"] }), "me", fr), "en attente de toi");
});

// "Since your review": what changed in the history, not just whether the last commit did.
const since = (commits) => story(pr({ latest: [review("me", "COMMENTED", "old")], commits }), "me").sinceMyReview;

test("since your review: a new commit after the reviewed one is a push", () => {
  assert.equal(since([commit("old"), commit("head", AFTER)]), "pushed");
  assert.equal(recap(pr({ latest: [review("me", "COMMENTED", "old")], commits: [commit("old"), commit("head", AFTER)] })), "pushed since your review");
});

test("since your review: a commit made before the review but pushed after it is still a push", () => {
  assert.equal(since([commit("old"), commit("head", BEFORE)]), "pushed");
});

test("since your review: only merges of the base branch are nothing new", () => {
  assert.equal(since([commit("old"), commit("m1", AFTER, 2), commit("head", AFTER, 2)]), "nothing");
  assert.equal(recap(pr({ latest: [review("me", "COMMENTED", "old")], commits: [commit("old"), commit("head", AFTER, 2)] })), "nothing new since your review");
});

test("since your review: a rebase is said as one, not as a push", () => {
  assert.equal(since([commit("a2"), commit("head")]), "rebased"); // rewritten, author dates kept
  assert.equal(recap(pr({ latest: [review("me", "COMMENTED", "old")], commits: [commit("head")] })), "rebased since your review");
  assert.equal(recap(pr({ latest: [review("me", "COMMENTED", "old")], commits: [commit("head")] }), "me", fr), "rebasée depuis ta review");
});

test("since your review: a rebase with a commit written after the review is a push", () => {
  assert.equal(since([commit("a2"), commit("head", AFTER)]), "pushed");
  assert.equal(since([commit("a2"), commit("m1", AFTER, 2), commit("head")]), "rebased"); // a merge isn't new work
});

test("since your review: without the commits (details stored before they were fetched), nothing is said", () => {
  const p = { ...pr({ latest: [review("me", "COMMENTED", "old")] }), commits: undefined };
  assert.equal(story(p, "me").sinceMyReview, undefined);
  assert.equal(recap(p), "no reviewers yet");
});

// Threads: outdated (the code under them changed) and when the last comment was made.
const reviewedOld = (threads, commits = [commit("old"), commit("head", AFTER)]) =>
  story(pr({ latest: [review("me", "COMMENTED", "old")], commits, threads }), "me").threads.answered;

test("threads: an answer only counts if it came after your last review", () => {
  assert.equal(reviewedOld([thread("me", "ana", false, { at: AFTER })]), 1);
  assert.equal(reviewedOld([thread("me", "ana", false, { at: BEFORE })]), 0); // you've reviewed since
  assert.equal(reviewedOld([thread("me", "ana")]), 1); // no time known: it counts
});

test("threads: changing the code under your thread answers it, if it changed since your review", () => {
  assert.equal(reviewedOld([thread("me", "me", false, { outdated: true })]), 1);
  assert.equal(reviewedOld([thread("me", "me", false, { outdated: true })], [commit("old"), commit("head", AFTER, 2)]), 0); // only a merge since
  assert.equal(reviewedOld([thread("me", "me")]), 0); // not outdated: still waiting on the author
  assert.equal(recap(pr({ latest: [review("me", "COMMENTED", "old")], commits: [commit("old"), commit("head", AFTER)],
    threads: [thread("me", "me", false, { outdated: true })] })), "ana answered your thread · pushed since your review");
});

test("threads: on your pull request, an outdated thread is the reviewer's turn", () => {
  const p = pr({ author: "me", threads: [thread("leo", "leo", false, { outdated: true }), thread("leo", "leo")] });
  assert.equal(story(p, "me").threads.waitingOnMe, 1);
  assert.equal(recap(p), "1 thread waits on you");
});

test("roles: author, reviewer, team-reviewer, watcher", () => {
  assert.equal(story(pr({ author: "me" }), "me").role, "author");
  assert.equal(story(pr({ requested: ["me"] }), "me").role, "reviewer"); // asked by name (seen in the details)
  assert.equal(story(pr(), "me", { asked: "me" }).role, "reviewer");
  assert.equal(story(pr({ latest: [review("me", "COMMENTED")] }), "me", { asked: "team" }).role, "reviewer"); // reviewed
  assert.equal(story(pr({ requested: ["@planning"] }), "me", { asked: "team" }).role, "team-reviewer");
  assert.equal(story(pr(), "me").role, "watcher");
});

test("roles: anyone but the author has threads answered", () => {
  const p = pr({ threads: [thread("me", "ana")] });
  assert.equal(story(p, "me", { asked: "team" }).threads.answered, 1);
  assert.equal(story(p, "me").threads.answered, 1); // a watcher who once started a thread
});

test("decision: GitHub's review decision", () => {
  assert.equal(story(pr({ reviewDecision: "APPROVED" }), "me").decision, "approved");
  assert.equal(story(pr({ reviewDecision: "CHANGES_REQUESTED" }), "me").decision, "changes");
  assert.equal(story(pr({ reviewDecision: "REVIEW_REQUIRED" }), "me").decision, "review-required");
  assert.equal(story(pr({ reviewDecision: null }), "me").decision, null);
});

test("decision: approved by some, but GitHub still wants a review and nobody's asked", () => {
  const p = pr({ author: "me", reviewDecision: "REVIEW_REQUIRED", opinions: [review("bill", "APPROVED")] });
  assert.equal(recap(p), "needs another approval · bill approved");
  assert.equal(recap(p, "me", fr), "il manque une approbation · bill a approuvé");
  // someone's asked: that's said instead
  assert.equal(recap(pr({ author: "me", reviewDecision: "REVIEW_REQUIRED", requested: ["@beta"], opinions: [review("bill", "APPROVED")] })),
    "waiting on team beta · bill approved");
  // no review rule: approvals are enough to say
  assert.equal(recap(pr({ author: "me", opinions: [review("bill", "APPROVED")] })), "bill approved");
});

test("your team: an approval on its behalf covers it, and says so", () => {
  const p = pr({ requested: ["@sre"], opinions: [review("bill", "APPROVED", "head", ["planning"])] });
  const st = story(p, "me", { asked: "team", teams: ["planning"] });
  assert.deepEqual(st.myTeamCovered, ["planning"]);
  assert.equal(plainRecap(st, en), "waiting on team sre · bill approved for your team planning");
  assert.equal(plainRecap(st, fr), "en attente de l'équipe sre · bill a approuvé pour ton équipe planning");
});

test("your team: another team's approval isn't yours; several approvals mark yours", () => {
  assert.deepEqual(story(pr({ opinions: [review("bill", "APPROVED", "head", ["alpha"])] }), "me", { teams: ["planning"] }).myTeamCovered, []);
  const p = pr({ opinions: [review("bill", "APPROVED", "head", ["planning", "alpha"]), review("maya", "APPROVED")] });
  assert.equal(plainRecap(story(p, "me", { teams: ["planning"] }), en), "approved by bill (your team planning, alpha) and maya");
});

// Excerpts: what was said in the threads that ask something of you.
const T1 = "2026-03-03T01:00:00Z", T2 = "2026-03-03T02:00:00Z", T3 = "2026-03-03T03:00:00Z", T4 = "2026-03-03T04:00:00Z";

test("excerpts: on your pull request, the last word of the threads waiting on you", () => {
  const p = pr({ author: "me", threads: [
    thread("leo", "leo", false, { at: T1, text: "Why not a map here?" }),
    thread("leo", "me", false, { at: T2, text: "my own answer" }), // you spoke last
    thread("leo", "leo", false, { at: T3, text: "outdated", outdated: true }), // the reviewer's turn
    thread("leo", "ci[bot]", false, { at: T4, text: "bot noise" }),
    thread("maya", "maya", true, { at: T4, text: "resolved" }),
  ] });
  assert.deepEqual(story(p, "me").excerpts, [{ by: "leo", text: "Why not a map here?" }]);
});

test("excerpts: on someone else's, the author's replies since your review, newest first, three at most", () => {
  const p = pr({ latest: [review("me", "COMMENTED", "old")], commits: [commit("old"), commit("head", AFTER)], threads: [
    thread("me", "ana", false, { at: T1, text: "one" }),
    thread("me", "ana", false, { at: T4, text: "four" }),
    thread("me", "ana", false, { at: T2, text: "two" }),
    thread("me", "ana", false, { at: T3, text: "three" }),
    thread("me", "ana", false, { at: BEFORE, text: "seen: before your review" }),
    thread("me", "me", false, { at: T4, text: "answered by code only", outdated: true }),
  ] });
  const st = story(p, "me");
  assert.equal(st.threads.answered, 5);
  assert.deepEqual(st.excerpts.map((x) => x.text), ["four", "three", "two"]);
  assert.deepEqual(st.excerpts.map((x) => x.by), ["ana", "ana", "ana"]);
});

test("excerpts: one short line, cut at a word", () => {
  const long = `Kept the hook as is:\n\n    splitting it ${"means touching every caller ".repeat(6)}so see #23540.`;
  const [x] = story(pr({ author: "me", threads: [thread("leo", "leo", false, { text: long })] }), "me").excerpts;
  assert.ok(!x.text.includes("\n") && !x.text.includes("  "));
  assert.ok(x.text.length <= 121 && x.text.endsWith("…"));
  assert.ok(x.text.startsWith("Kept the hook as is: splitting it means"));
  assert.match(x.text, /\w…$/); // no half word, no trailing comma
});

test("excerpts: a thread without text gives none", () => {
  assert.deepEqual(story(pr({ author: "me", threads: [thread("leo", "leo")] }), "me").excerpts, []);
});

test("excerpts: said in each language", () => {
  assert.equal(en.recap.said("leo", "Why not a map here?"), 'leo: "Why not a map here?"');
  assert.equal(fr.recap.said("leo", "Pourquoi pas une map ?"), "leo : « Pourquoi pas une map ? »");
});

test("on your own pull request, threads where someone else spoke last wait on you", () => {
  const p = pr({ author: "me", threads: [thread("leo", "leo"), thread("leo", "me"), thread("maya", "maya", true), thread("leo", "ci[bot]")] });
  assert.equal(story(p, "me").threads.waitingOnMe, 1);
  assert.equal(recap(p), "1 thread waits on you");
});

test("you are 'you'; bots don't count", () => {
  const p = pr({ author: "ana", opinions: [review("me", "APPROVED"), review("deps[bot]", "CHANGES_REQUESTED")] });
  const st = story(p, "me");
  assert.deepEqual(st.changesRequested, []);
  assert.equal(plainRecap(st, en), "you approved · nothing new since your review");
});

test("the most pressing three clauses, in order", () => {
  const p = pr({
    author: "me", ci: "failed", mergeable: "CONFLICTING", mergeState: "DIRTY", requested: ["@beta"],
    opinions: [review("maya", "CHANGES_REQUESTED")], threads: [thread("maya", "maya")],
  });
  assert.equal(recap(p), "1 thread waits on you · conflicts with main · changes requested by maya");
});

test("mergeability: conflicts", () => {
  const p = pr({ mergeable: "CONFLICTING", mergeState: "DIRTY", opinions: [review("bill", "APPROVED")] });
  assert.equal(story(p, "me").merge, "conflicts");
  assert.equal(recap(p), "conflicts with main · bill approved");
});

test("mergeability: behind its base branch", () => {
  const p = pr({ base: "develop", mergeState: "BEHIND", opinions: [review("bill", "APPROVED")] });
  assert.equal(recap(p), "behind develop · bill approved");
});

test("mergeability: ready to merge stands alone", () => {
  const p = pr({ author: "me", mergeState: "CLEAN", opinions: [review("bill", "APPROVED", "head", ["alpha"])] });
  assert.equal(recap(p), "ready to merge");
});

test("mergeability: ready, but a thread still waits on you", () => {
  const p = pr({ author: "me", mergeState: "CLEAN", threads: [thread("leo", "leo")] });
  assert.equal(recap(p), "1 thread waits on you");
});

test("mergeability: blocked adds nothing; unstable only when nothing else is said", () => {
  assert.equal(recap(pr({ requested: ["leo"] })), "waiting on leo");
  assert.equal(recap(pr({ mergeState: "UNSTABLE", requested: ["leo"] })), "waiting on leo");
  assert.equal(recap(pr({ mergeState: "UNSTABLE" })), "mergeable · some optional checks fail");
});

test("mergeability: unknown says nothing", () => {
  const unknown = story(pr({ mergeable: "UNKNOWN", mergeState: "UNKNOWN", opinions: [review("bill", "APPROVED")] }), "me");
  assert.equal(unknown.merge, null);
  assert.equal(plainRecap(unknown, en), "bill approved");
});

test("a draft is never 'ready to merge'", () => {
  const p = pr({ author: "me", draft: true, mergeState: "CLEAN" });
  assert.equal(recap(p), "draft · no reviewers yet");
});

test("a draft says so only when it's why nobody's asked yet", () => {
  assert.equal(recap(pr({ author: "me", draft: true })), "draft · no reviewers yet");
  assert.equal(recap(pr({ author: "me", draft: true }), "me", fr), "draft · pas encore de reviewers");
  assert.equal(recap(pr({ author: "me", draft: true, requested: ["leo"] })), "waiting on leo");
  assert.equal(recap(pr({ author: "me" })), "no reviewers yet");
});

test("long lists are cut at three names", () => {
  assert.equal(recap(pr({ requested: ["@a", "@b", "@c", "@d", "@e"] })), "waiting on team a, team b, team c and 2 more");
  assert.equal(recap(pr({ requested: ["@a", "@b", "@c", "@d"] }), "me", fr), "en attente de l'équipe a, l'équipe b, l'équipe c et 1 autre");
});

test("a login keeps its case", () => {
  assert.equal(recap(pr({ opinions: [review("Bill", "APPROVED")], latest: [] })), "Bill approved");
});

test("CI red", () => {
  assert.equal(recap(pr({ ci: "failed", opinions: [review("bill", "APPROVED")] })), "CI red · bill approved");
});

test("more threads than fetched", () => {
  const threads = Array.from({ length: 50 }, () => thread("leo", "leo"));
  assert.equal(recap(pr({ author: "me", threads, total: 63 })), "50+ threads wait on you");
});

test("no details yet: no recap", () => {
  assert.equal(plainRecap(story({ author: "ana", ci: "success" }, "me"), en), null);
});

test("French", () => {
  assert.equal(recap(pr({ requested: ["@beta"], opinions: [review("bill", "APPROVED", "head", ["alpha"])] }), "me", fr),
    "en attente de l'équipe beta · bill a approuvé pour l'équipe alpha");
  assert.equal(recap(pr({ latest: [review("me", "COMMENTED", "old")], commits: [commit("old"), commit("head", AFTER)], threads: [thread("me", "ana")] }), "me", fr),
    "ana a répondu à ton fil · nouveaux commits depuis ta review");
  assert.equal(recap(pr({ opinions: [review("me", "CHANGES_REQUESTED")] }), "me", fr), "changements demandés par toi · rien de nouveau depuis ta review");
  assert.equal(recap(pr({ author: "me", mergeState: "CLEAN" }), "me", fr), "prête à merger");
});

// ---- nextRecaps: what the badge copy runs after each check ----

const listed = (key, extra = {}) => ({ key, title: key, author: "ana", ci: "success", oid: "head", mergeState: "BLOCKED", base: "main", updated: "t1", ...extra });
const check = (prs, reviews = []) => ({ me: "me", pinned: [], prs, reviews });
const detailsOf = (opinions = []) => ({ reviewRequests: { nodes: [] }, latestOpinionatedReviews: { nodes: opinions }, latestReviews: { nodes: [] }, reviewThreads: { totalCount: 0, nodes: [] } });
const fetcher = (answer) => {
  const calls = [];
  const fetch = async (keys) => { calls.push(keys); return typeof answer === "function" ? answer(keys) : answer; };
  return { fetch, calls };
};

test("nextRecaps: fetches the new pull requests' details and builds their recaps", async () => {
  const { fetch, calls } = fetcher({ "a/b#1": detailsOf([review("bill", "APPROVED")]) });
  const { recaps, errors } = await nextRecaps(check([listed("a/b#1")]), {}, fetch, en, { now: 1000 });
  assert.deepEqual(calls, [["a/b#1"]]);
  assert.deepEqual(errors, []);
  assert.equal(recaps["a/b#1"].plain, "bill approved");
  assert.equal(recaps["a/b#1"].updated, "t1");
});

test("nextRecaps: a failed fetch keeps what was known, and doesn't throw", async () => {
  const prev = { "a/b#1": { updated: "t0", at: 0, details: detailsOf([review("bill", "APPROVED")]), plain: "bill approved" } };
  const fetch = async () => { throw new Error("gh exited 1"); };
  const { recaps, errors } = await nextRecaps(check([listed("a/b#1", { ci: "failed" })]), prev, fetch, en, { now: 1000 });
  assert.deepEqual(errors, ["gh exited 1"]);
  assert.equal(recaps["a/b#1"].plain, "CI red · bill approved"); // rebuilt from the known details and this check's CI
  assert.equal(recaps["a/b#1"].updated, "t0"); // still due: fetched again next check
});

test("nextRecaps: an answer it can't read keeps that recap's last sentence, the others are built", async () => {
  const odd = { get reviewRequests() { throw new Error("unexpected shape"); } };
  const prev = { "a/b#1": { updated: "t0", at: 0, details: detailsOf(), plain: "earlier sentence" } };
  const { fetch } = fetcher({ "a/b#1": odd, "a/b#2": detailsOf([review("maya", "APPROVED")]) });
  const { recaps, errors } = await nextRecaps(check([listed("a/b#1"), listed("a/b#2")]), prev, fetch, en, { now: 1000 });
  assert.equal(recaps["a/b#1"].plain, "earlier sentence");
  assert.equal(recaps["a/b#2"].plain, "maya approved");
  assert.deepEqual(errors, ["a/b#1: unexpected shape"]);
});

test("nextRecaps: details are fetched again only when updated or stale", async () => {
  const known = (updated, at) => ({ updated, at, details: detailsOf(), plain: "x" });
  const prev = { "a/b#1": known("t1", 0), "a/b#2": known("t0", 0), "a/b#3": known("t1", -RECAP_STALE - 1) };
  const { fetch, calls } = fetcher((keys) => Object.fromEntries(keys.map((k) => [k, detailsOf()])));
  await nextRecaps(check([listed("a/b#1"), listed("a/b#2"), listed("a/b#3")]), prev, fetch, en, { now: 0 });
  assert.deepEqual(calls, [["a/b#2", "a/b#3"]]);
});

test("nextRecaps: nothing due, nothing fetched; pull requests no longer listed are dropped", async () => {
  const prev = { "a/b#1": { updated: "t1", at: 0, details: detailsOf(), plain: "x" }, "a/b#9": { updated: "t1", at: 0, details: detailsOf(), plain: "y" } };
  const { fetch, calls } = fetcher({});
  const { recaps } = await nextRecaps(check([listed("a/b#1")]), prev, fetch, en, { now: 0 });
  assert.deepEqual(calls, []);
  assert.deepEqual(Object.keys(recaps), ["a/b#1"]);
});

test("a pinned pull request's recap says everything, the others three things at most", async () => {
  const busy = { ci: "failed", mergeable: "CONFLICTING", mergeState: "DIRTY" };
  const d = detailsOf([review("maya", "CHANGES_REQUESTED"), review("bill", "APPROVED", "head", ["alpha"])]);
  d.reviewRequests = { nodes: [{ requestedReviewer: { __typename: "Team", slug: "beta" } }] };
  const o = { ...check([listed("a/b#2", busy)]), pinned: [listed("a/b#1", busy)] };
  const { fetch } = fetcher({ "a/b#1": d, "a/b#2": d });
  const { recaps } = await nextRecaps(o, {}, fetch, en, { now: 0 });
  assert.equal(recaps["a/b#1"].plain, "conflicts with main · changes requested by maya · CI red · waiting on team beta · bill approved for team alpha");
  assert.equal(recaps["a/b#2"].plain, "conflicts with main · changes requested by maya · CI red");
});

test("nextRecaps: the review decision reaches the recap", async () => {
  const o = { ...check([], [listed("a/b#1", { team: false }), listed("a/b#2", { team: true })]), pinned: [listed("a/b#3")] };
  const d = { ...detailsOf(), latestOpinionatedReviews: { nodes: [review("bill", "APPROVED")] }, reviewDecision: "REVIEW_REQUIRED" };
  const { fetch } = fetcher({ "a/b#1": d, "a/b#2": d, "a/b#3": d });
  const { recaps } = await nextRecaps(o, {}, fetch, en, { now: 0 });
  assert.equal(recaps["a/b#1"].plain, "needs another approval · bill approved");
  assert.equal(recaps["a/b#3"].plain, "needs another approval · bill approved");
});

test("nextRecaps: your teams are matched in each pull request's own org", async () => {
  const d = detailsOf([review("bill", "APPROVED", "head", ["planning"])]);
  const { fetch } = fetcher({ "acme/web#1": d, "other/x#2": d });
  const { recaps } = await nextRecaps(check([listed("acme/web#1"), listed("other/x#2")]), {}, fetch, en, { now: 0, teams: ["acme/planning"] });
  assert.equal(recaps["acme/web#1"].plain, "bill approved for your team planning");
  assert.equal(recaps["other/x#2"].plain, "bill approved for team planning"); // a team of the same name elsewhere
});

test("nextTeams: fetched when missing or stale, kept otherwise", async () => {
  let calls = 0;
  const fetch = async () => { calls++; return ["acme/planning"]; };
  const first = await nextTeams(undefined, fetch, 1000);
  assert.deepEqual(first.cache, { at: 1000, teams: ["acme/planning"] });
  const kept = await nextTeams(first.cache, fetch, 1000 + TEAMS_STALE - 1);
  assert.equal(kept.cache, first.cache);
  await nextTeams(first.cache, fetch, 1000 + TEAMS_STALE + 1);
  assert.equal(calls, 2);
});

test("nextTeams: a failure keeps the teams known and is retried sooner; it never throws", async () => {
  const fail = async () => { throw new Error("missing read:org"); };
  const known = { at: 0, teams: ["acme/planning"] };
  const t = await nextTeams(known, fail, TEAMS_STALE + 1);
  assert.equal(t.error, "missing read:org");
  assert.deepEqual(t.cache.teams, ["acme/planning"]);
  const soon = await nextTeams(t.cache, async () => ["acme/api"], TEAMS_STALE + 1 + RECAP_STALE + 1);
  assert.deepEqual(soon.cache.teams, ["acme/api"]);
  assert.deepEqual((await nextTeams(undefined, fail, 0)).cache.teams, []);
});

test("nextRecaps: keeps each recap's excerpts", async () => {
  const d = { ...detailsOf(), reviewThreads: { totalCount: 1, nodes: [thread("leo", "leo", false, { text: "Why not a map?" })] } };
  const { fetch } = fetcher({ "a/b#1": d });
  const { recaps } = await nextRecaps(check([listed("a/b#1", { author: "me" })]), {}, fetch, en, { now: 0 });
  assert.equal(recaps["a/b#1"].plain, "1 thread waits on you");
  assert.deepEqual(recaps["a/b#1"].excerpts, [{ by: "leo", text: "Why not a map?" }]);
});

test("nextRecaps: at most RECAP_FETCH fetched per check, pinned and mine first", async () => {
  const mine = Array.from({ length: RECAP_FETCH + 5 }, (_, i) => listed(`a/b#${i + 1}`));
  const { fetch, calls } = fetcher({});
  const o = { ...check(mine, [listed("a/b#100", { team: false })]), pinned: [listed("a/b#200")] };
  await nextRecaps(o, {}, fetch, en, { now: 0 });
  assert.equal(calls[0].length, RECAP_FETCH);
  assert.equal(calls[0][0], "a/b#200");
  assert.ok(!calls[0].includes("a/b#100"));
});
