// Made-up data for `"demo": true`: screenshots without anyone's real pull requests.

const ago = (min) => new Date(Date.now() - min * 60000).toISOString();
const p = (repo, number, title, author, ci, extra = {}) => ({
  key: `${repo}#${number}`, repo, number, title, author, ci, draft: false, oid: `demo${number}`,
  url: `https://github.com/${repo}/pull/${number}`, ...extra,
});

export const demoOverview = () => ({
  me: "you",
  reviews: [
    p("acme/web", 412, "Checkout: keep the cart when the session expires", "maya", "success", { team: false }),
    p("acme/api", 1290, "Rate-limit the export endpoint", "leo", "pending", { team: true }),
    p("acme/infra", 88, "Move staging to the new cluster", "sam", "success", { team: true }),
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
