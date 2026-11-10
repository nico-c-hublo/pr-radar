import { test } from "node:test";
import assert from "node:assert/strict";
import { story, plainRecap, nextRecaps, RECAP_FETCH, RECAP_STALE } from "../mods/pr-radar/recap.js";
import { strings } from "../mods/pr-radar/i18n.js";

// Fixtures in the shape github.js gives: a pull request with its details (GraphQL's own nodes).
const user = (login) => ({ login, __typename: "User" });
const bot = (login) => ({ login, __typename: "Bot" });
const review = (login, state, oid = "head", teams = []) => ({
  author: login.endsWith("[bot]") ? bot(login) : user(login), state, commit: { oid },
  onBehalfOf: { nodes: teams.map((slug) => ({ slug })) },
});
const thread = (starter, last, isResolved = false) => ({
  isResolved, first: { nodes: [{ author: user(starter) }] }, last: { nodes: [{ author: last.endsWith("[bot]") ? bot(last) : user(last) }] },
});
const pr = ({ author = "ana", requested = [], opinions = [], latest = opinions, threads = [], total, ...rest } = {}) => ({
  author, draft: false, ci: "success", oid: "head", mergeable: "MERGEABLE", mergeState: "BLOCKED", base: "main",
  reviewRequests: { nodes: requested.map((r) => ({ requestedReviewer: r.startsWith("@") ? { __typename: "Team", slug: r.slice(1) } : user(r) })) },
  latestOpinionatedReviews: { nodes: opinions },
  latestReviews: { nodes: latest },
  reviewThreads: { totalCount: total ?? threads.length, nodes: threads },
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
  const p = pr({ latest: [review("me", "COMMENTED", "old")], threads: [thread("me", "ana"), thread("me", "ana"), thread("me", "me"), thread("leo", "ana")] });
  const st = story(p, "me");
  assert.equal(st.threads.answered, 2);
  assert.equal(st.pushedSinceMyReview, true);
  assert.equal(plainRecap(st, en), "ana answered your 2 threads · pushed since your review");
});

test("nothing new since your review", () => {
  const p = pr({ latest: [review("me", "COMMENTED", "head")], threads: [thread("me", "me")] });
  assert.equal(story(p, "me").pushedSinceMyReview, false);
  assert.equal(recap(p), "nothing new since your review");
});

test("never reviewed: nothing is said about since your review", () => {
  const p = pr({ requested: ["me"] });
  assert.equal(story(p, "me").pushedSinceMyReview, null);
  assert.equal(recap(p), "waiting on you");
});

test("a review asked of you is never 'no reviewers yet'", () => {
  assert.equal(recap(pr({ requested: ["@planning", "me"] })), "waiting on team planning and you");
  assert.equal(recap(pr({ requested: ["me"] }), "me", fr), "en attente de toi");
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
  assert.equal(recap(pr({ latest: [review("me", "COMMENTED", "old")], threads: [thread("me", "ana")] }), "me", fr),
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
  const { recaps, errors } = await nextRecaps(check([listed("a/b#1")]), {}, fetch, en, 1000);
  assert.deepEqual(calls, [["a/b#1"]]);
  assert.deepEqual(errors, []);
  assert.equal(recaps["a/b#1"].plain, "bill approved");
  assert.equal(recaps["a/b#1"].updated, "t1");
});

test("nextRecaps: a failed fetch keeps what was known, and doesn't throw", async () => {
  const prev = { "a/b#1": { updated: "t0", at: 0, details: detailsOf([review("bill", "APPROVED")]), plain: "bill approved" } };
  const fetch = async () => { throw new Error("gh exited 1"); };
  const { recaps, errors } = await nextRecaps(check([listed("a/b#1", { ci: "failed" })]), prev, fetch, en, 1000);
  assert.deepEqual(errors, ["gh exited 1"]);
  assert.equal(recaps["a/b#1"].plain, "CI red · bill approved"); // rebuilt from the known details and this check's CI
  assert.equal(recaps["a/b#1"].updated, "t0"); // still due: fetched again next check
});

test("nextRecaps: an answer it can't read keeps that recap's last sentence, the others are built", async () => {
  const odd = { get reviewRequests() { throw new Error("unexpected shape"); } };
  const prev = { "a/b#1": { updated: "t0", at: 0, details: detailsOf(), plain: "earlier sentence" } };
  const { fetch } = fetcher({ "a/b#1": odd, "a/b#2": detailsOf([review("maya", "APPROVED")]) });
  const { recaps, errors } = await nextRecaps(check([listed("a/b#1"), listed("a/b#2")]), prev, fetch, en, 1000);
  assert.equal(recaps["a/b#1"].plain, "earlier sentence");
  assert.equal(recaps["a/b#2"].plain, "maya approved");
  assert.deepEqual(errors, ["a/b#1: unexpected shape"]);
});

test("nextRecaps: details are fetched again only when updated or stale", async () => {
  const known = (updated, at) => ({ updated, at, details: detailsOf(), plain: "x" });
  const prev = { "a/b#1": known("t1", 0), "a/b#2": known("t0", 0), "a/b#3": known("t1", -RECAP_STALE - 1) };
  const { fetch, calls } = fetcher((keys) => Object.fromEntries(keys.map((k) => [k, detailsOf()])));
  await nextRecaps(check([listed("a/b#1"), listed("a/b#2"), listed("a/b#3")]), prev, fetch, en, 0);
  assert.deepEqual(calls, [["a/b#2", "a/b#3"]]);
});

test("nextRecaps: nothing due, nothing fetched; pull requests no longer listed are dropped", async () => {
  const prev = { "a/b#1": { updated: "t1", at: 0, details: detailsOf(), plain: "x" }, "a/b#9": { updated: "t1", at: 0, details: detailsOf(), plain: "y" } };
  const { fetch, calls } = fetcher({});
  const { recaps } = await nextRecaps(check([listed("a/b#1")]), prev, fetch, en, 0);
  assert.deepEqual(calls, []);
  assert.deepEqual(Object.keys(recaps), ["a/b#1"]);
});

test("nextRecaps: at most RECAP_FETCH fetched per check, pinned and mine first", async () => {
  const mine = Array.from({ length: RECAP_FETCH + 5 }, (_, i) => listed(`a/b#${i + 1}`));
  const { fetch, calls } = fetcher({});
  const o = { ...check(mine, [listed("a/b#100", { team: false })]), pinned: [listed("a/b#200")] };
  await nextRecaps(o, {}, fetch, en, 0);
  assert.equal(calls[0].length, RECAP_FETCH);
  assert.equal(calls[0][0], "a/b#200");
  assert.ok(!calls[0].includes("a/b#100"));
});
