// A pull request's recap: one sentence saying where it stands, from the viewer's point of view.
// Pure (no Herdr), so it's tested with fixtures:
//   story(pr, me)          what GitHub's answer says, worked out: the facts a sentence is made of;
//   plainRecap(story, s)   the sentence, from fixed templates (i18n.js `recap`), most pressing first;
//   nextRecaps(...)        after a check: which pull requests get one, which details to fetch again,
//                          and every recap rebuilt (the badge copy stores the result).
// `pr` is a pull request as github.js returns it (author, draft, ci, oid, mergeable, mergeState,
// base) with its details merged in (reviewRequests, latestOpinionatedReviews, latestReviews,
// reviewThreads, commits: GraphQL's own shape).

const nodes = (c) => (Array.isArray(c?.nodes) ? c.nodes.filter(Boolean) : []);
const isBot = (a) => !a || a.__typename === "Bot" || /\[bot\]$/.test(a.login ?? "");

// mergeable + mergeStateStatus -> what the recap can say about merging; null: GitHub is still
// computing it (it does so lazily after a push), or nothing to say.
function merge(pr) {
  if (pr.mergeable === "CONFLICTING" || pr.mergeState === "DIRTY") return "conflicts";
  switch (pr.mergeState) {
    case "BEHIND": return "behind";
    case "BLOCKED": return "blocked";
    case "UNSTABLE": return "unstable";
    case "CLEAN": case "HAS_HOOKS": return pr.draft ? null : "ready";
    default: return null; // UNKNOWN, DRAFT, missing
  }
}

// What happened to the code since the viewer's last review (of any kind):
//   null       never reviewed;
//   "nothing"  the same commit, or only merges from the base branch on top of it;
//   "pushed"   new commits;
//   "rebased"  the history was rewritten (a rebase, an amend) and no commit was written after the
//              review: rebasing keeps a commit's author date. The code may differ, so it's said;
//   undefined  the commits weren't fetched (details stored by an older version): nothing is said.
// With the reviewed commit still in the history, what follows it is new, whatever its author date
// (commits made before the review can be pushed after it). Merge commits (two parents) don't count.
function since(pr, mine) {
  if (!mine) return null;
  const reviewed = mine.commit?.oid;
  if (!reviewed || !pr.oid || reviewed === pr.oid) return "nothing";
  if (!pr.commits) return undefined;
  const commits = nodes(pr.commits).map((c) => c.commit).filter(Boolean);
  const own = (c) => (c.parents?.totalCount ?? 1) < 2;
  const at = commits.findIndex((c) => c.oid === reviewed);
  if (at >= 0) return commits.slice(at + 1).some(own) ? "pushed" : "nothing";
  const after = Date.parse(mine.submittedAt);
  return commits.some((c) => own(c) && Date.parse(c.authoredDate) > after) ? "pushed" : "rebased";
}

export function story(pr, me) {
  const who = (login) => (login === me ? "you" : login);
  const author = pr.author ?? "";
  const role = author === me ? "author" : "reviewer";

  const opinions = nodes(pr.latestOpinionatedReviews).filter((r) => !isBot(r.author));
  const approvals = opinions.filter((r) => r.state === "APPROVED")
    .map((r) => ({ by: who(r.author.login), teams: nodes(r.onBehalfOf).map((t) => t.slug) }));
  const changesRequested = opinions.filter((r) => r.state === "CHANGES_REQUESTED").map((r) => ({ by: who(r.author.login) }));

  const requested = nodes(pr.reviewRequests).map((r) => r.requestedReviewer).filter(Boolean);
  const waitingOn = {
    users: requested.filter((r) => r.login && r.__typename !== "Bot").map((r) => who(r.login)), // "you" too
    teams: requested.filter((r) => r.__typename === "Team").map((r) => r.slug),
  };

  const sinceMyReview = since(pr, nodes(pr.latestReviews).find((r) => r.author?.login === me));

  // Unresolved threads, by who started them and who spoke last (bots don't count as speaking).
  const open = nodes(pr.reviewThreads).filter((t) => !t.isResolved).map((t) => ({
    starter: nodes(t.first)[0]?.author, last: nodes(t.last)[0]?.author,
  }));
  const spoke = (a) => a && !isBot(a);
  const threads = {
    open: open.length,
    // On your pull request: someone else spoke last.
    waitingOnMe: role === "author" ? open.filter((t) => spoke(t.last) && t.last.login !== me).length : 0,
    // On someone else's: threads you started where the author spoke last.
    answered: role === "reviewer" ? open.filter((t) => t.starter?.login === me && t.last?.login === author).length : 0,
    capped: (pr.reviewThreads?.totalCount ?? 0) > nodes(pr.reviewThreads).length,
  };

  return {
    role, author: who(author), draft: Boolean(pr.draft), ci: pr.ci ?? null, merge: merge(pr), base: pr.base ?? "",
    approvals, changesRequested, waitingOn, threads, sinceMyReview,
    detailed: Boolean(pr.reviewRequests || pr.latestOpinionatedReviews || pr.latestReviews || pr.reviewThreads),
  };
}

const MAX_CLAUSES = 3;

// The story as one sentence: what asks something of you, then what blocks the merge, then progress.
// Lowercase, like the panel's other notes: a sentence often starts with a login, which keeps its case.
export function plainRecap(st, s) {
  const r = s.recap;
  if (!st.detailed) return null; // no details fetched yet: say nothing rather than half
  const n = (count) => (st.threads.capped && count === st.threads.open ? `${count}+` : count);
  const clauses = [];
  if (st.threads.waitingOnMe) clauses.push(r.waitingOnMe(n(st.threads.waitingOnMe)));
  if (st.merge === "conflicts") clauses.push(r.conflicts(st.base));
  if (st.threads.answered) clauses.push(r.answered(st.author, n(st.threads.answered)));
  if (st.sinceMyReview === "pushed") clauses.push(r.pushed);
  if (st.sinceMyReview === "rebased") clauses.push(r.rebased);
  if (st.changesRequested.length) clauses.push(r.changesRequested(st.changesRequested.map((c) => c.by)));
  if (st.ci === "failed") clauses.push(r.ciRed);
  if (st.merge === "behind") clauses.push(r.behind(st.base));
  const blocking = clauses.length;
  if (!blocking && st.merge === "ready") return r.ready;
  const { users, teams } = st.waitingOn;
  if (users.length || teams.length) clauses.push(r.waitingOn(teams, users));
  if (st.approvals.length) clauses.push(r.approved(st.approvals));
  if (st.role === "reviewer" && st.sinceMyReview === "nothing" && !st.threads.answered) clauses.push(r.nothingNew);
  if (!clauses.length && st.merge === "unstable") clauses.push(r.unstable);
  // A draft says so only here, where it's why nobody's asked yet (the row's tag says it otherwise).
  if (!clauses.length && !st.approvals.length && !st.changesRequested.length) clauses.push(st.draft ? r.draftNoReviewers : r.noReviewers);
  return clauses.slice(0, MAX_CLAUSES).join(" · ");
}

// Which pull requests get a recap: at most RECAP_MAX (pinned, then mine, then reviews asked of me,
// then of my teams). Their details are fetched again when the pull request was updated, or at least
// every RECAP_STALE; RECAP_FETCH at most per check (the rest wait for the next one).
export const RECAP_MAX = 30, RECAP_FETCH = 15, RECAP_STALE = 15 * 60000;

// o: a check's answer (github.js overview); prev: the recaps stored after the last check
// ({ [key]: { updated, at, details, plain } }); fetchDetails(keys) -> { [key]: details | null }.
// -> { recaps, errors }. Never throws: recaps are extra, and a failure mustn't undo the check. A
// failed fetch keeps the details known; a recap that can't be built keeps its last sentence.
export async function nextRecaps(o, prev, fetchDetails, s, now = Date.now()) {
  const errors = [], byKey = new Map();
  const add = (p) => { if (p?.key && p.title && !byKey.has(p.key)) byKey.set(p.key, p); };
  (o?.pinned ?? []).forEach(add);
  (o?.prs ?? []).forEach(add);
  (o?.reviews ?? []).filter((r) => !r.team).forEach(add);
  (o?.reviews ?? []).filter((r) => r.team).forEach(add);
  const keys = [...byKey.keys()].slice(0, RECAP_MAX);
  const due = keys.filter((k) => !prev?.[k] || prev[k].updated !== byKey.get(k).updated || now - prev[k].at > RECAP_STALE)
    .slice(0, RECAP_FETCH);
  let got = {};
  if (due.length) {
    try { got = (await fetchDetails(due)) ?? {}; } catch (e) { errors.push(String(e?.message ?? e)); }
  }
  const recaps = {};
  for (const k of keys) {
    const c = got[k] ? { updated: byKey.get(k).updated, at: now, details: got[k] } : prev?.[k];
    if (!c) continue;
    try {
      recaps[k] = { ...c, plain: plainRecap(story({ ...byKey.get(k), ...c.details }, o.me), s) };
    } catch (e) {
      errors.push(`${k}: ${e?.message ?? e}`);
      if (prev?.[k]) recaps[k] = prev[k];
    }
  }
  return { recaps, errors };
}
