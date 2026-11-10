// Made-up data for `"demo": true`: screenshots without anyone's real pull requests.

const ago = (min) => new Date(Date.now() - min * 60000).toISOString();
const p = (repo, number, title, author, ci, extra = {}) => ({
  key: `${repo}#${number}`, repo, number, title, author, ci, draft: false, oid: `demo${number}`,
  url: `https://github.com/${repo}/pull/${number}`, updated: "2026-01-01T00:00:00Z",
  mergeable: "MERGEABLE", mergeState: "BLOCKED", base: "main", ...extra,
});

// What demo mode starts with pinned, and what the query would say of the pinned ones.
export const DEMO_PINS = ["acme/web#418"];
// The teams the demo's "you" is in.
export const DEMO_TEAMS = ["acme/platform", "acme/api"];
const DEMO_DECISIONS = { "acme/web#418": "changes" };

export const demoOverview = (pins = []) => {
  const o = demoLists();
  const all = [...o.reviews, ...o.prs];
  o.pinned = pins.map((key) => {
    const p = all.find((x) => x.key === key);
    return p ? { ...p, state: "open", decision: DEMO_DECISIONS[key] ?? null, last: null } : { key, unknown: true };
  });
  return o;
};

const demoLists = () => ({
  me: "you",
  reviews: [
    p("acme/web", 412, "Checkout: keep the cart when the session expires", "maya", "success", { team: false }),
    p("acme/api", 1290, "Rate-limit the export endpoint", "leo", "pending", { team: true, mergeState: "BEHIND" }),
    p("acme/infra", 88, "Move staging to the new cluster", "sam", "success", { team: true, mergeState: "CLEAN" }),
  ],
  prs: [
    p("acme/web", 418, "Search: debounce the suggestions", "you", "failed"),
    p("acme/api", 1301, "Add an index on orders.created_at", "you", "pending"),
    p("acme/web", 405, "Upgrade the date picker", "you", "success", { draft: true }),
  ],
  branches: [{ key: "acme/web@main", repo: "acme/web", branch: "main", oid: "3f9c2a1", url: "https://github.com/acme/web", ci: "success" }],
});

export const demoDiscussions = () => [
  { id: "d1", reason: "comment", repo: "acme/web", number: 418, title: "Search: debounce the suggestions", updated: ago(4), url: "https://github.com/acme/web/pull/418" },
  { id: "d2", reason: "mention", repo: "acme/api", number: 1287, title: "Paginate the audit log", updated: ago(52), url: "https://github.com/acme/api/pull/1287" },
];

// What a recap is made of, for the demo rows (the shape github.js `details` gives).
const user = (login) => ({ login, __typename: "User" });
const team = (slug) => ({ __typename: "Team", slug });
const review = (login, state, oid, teams = []) => ({ state, submittedAt: "2026-01-02T00:00:00Z", author: user(login), commit: { oid }, onBehalfOf: { nodes: teams.map((slug) => ({ slug })) } });
const commit = (oid, authoredDate = "2026-01-01T00:00:00Z") => ({ commit: { oid, authoredDate, parents: { totalCount: 1 } } });
const thread = (starter, last) => ({ isResolved: false, isOutdated: false, first: { nodes: [{ author: user(starter) }] },
  last: { nodes: [{ createdAt: "2026-01-03T00:00:00Z", author: user(last) }] } });
const detail = ({ asked = [], opinions = [], latest = opinions, threads = [], commits = [] }) => ({
  commits: { nodes: commits },
  reviewRequests: { nodes: asked.map((requestedReviewer) => ({ requestedReviewer })) },
  latestOpinionatedReviews: { nodes: opinions }, latestReviews: { nodes: latest },
  reviewThreads: { totalCount: threads.length, nodes: threads },
});
const DEMO_DETAILS = {
  "acme/web#418": detail({ opinions: [review("maya", "CHANGES_REQUESTED", "demo418")], threads: [thread("maya", "maya"), thread("maya", "maya")] }),
  "acme/api#1301": detail({ asked: [team("backend")], opinions: [review("leo", "APPROVED", "demo1301", ["platform"])] }),
  "acme/web#405": detail({}),
  "acme/web#412": detail({ latest: [review("you", "COMMENTED", "old412")], commits: [commit("old412"), commit("demo412", "2026-01-03T00:00:00Z")],
    threads: [thread("you", "maya"), thread("you", "maya")] }),
  "acme/api#1290": detail({ opinions: [review("sam", "APPROVED", "demo1290", ["api"])] }),
  "acme/infra#88": detail({ opinions: [review("leo", "APPROVED", "demo88", ["infra"])] }),
};
export const demoDetails = (keys) => Object.fromEntries(keys.map((k) => [k, DEMO_DETAILS[k] ?? null]));
