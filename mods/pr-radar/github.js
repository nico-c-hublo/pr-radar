import { exec } from "herdr";

// GitHub through the gh CLI (the user's own login): one GraphQL query for review requests, the CI
// of the user's open pull requests and the watched branches, and the notifications API for
// discussions. Everything is scoped by the config (see config.js).

const msg = (e) => String(e?.message ?? e);

// gh, trying the Homebrew folders when the app's PATH doesn't have it. Only a program that
// couldn't start moves on; one that ran and failed is the answer. With `partial`, a GraphQL answer
// with errors (gh exits 1) still counts when it carries data: a pinned pull request or a watched
// branch that's gone mustn't hide everything else.
async function gh(args, { partial = false } = {}) {
  let last;
  for (const bin of ["gh", "/opt/homebrew/bin/gh", "/usr/local/bin/gh"]) {
    let r;
    try { r = await exec(bin, args, { timeout: 60000 }); } catch (e) { last = e; continue; }
    if (r.code === 127) { last = new Error("gh not found"); continue; }
    if (r.code !== 0 && partial && hasData(r.stdout)) return r.stdout;
    if (r.code !== 0) throw new Error((r.stderr || r.stdout).trim().split("\n")[0] || `gh exited ${r.code}`);
    return r.stdout;
  }
  throw new Error(`gh isn't installed or can't start: ${msg(last)}`);
}

const hasData = (out) => { try { return Boolean(JSON.parse(out)?.data); } catch { return false; } };

const host = (cfg) => (cfg.host && cfg.host !== "github.com" ? ["--hostname", cfg.host] : []);

// Search qualifiers for the scope: several org:/repo: qualifiers match any of them.
const scope = (cfg) => [...cfg.orgs.map((o) => `org:${o}`), ...cfg.repos.map((r) => `repo:${r}`)].join(" ");

// Whether a repository (owner/name) is in scope: everything when no org or repo is set.
export const inScope = (cfg, fullName) => {
  if (!cfg.orgs.length && !cfg.repos.length) return true;
  const owner = fullName.split("/")[0].toLowerCase();
  return cfg.orgs.some((o) => o.toLowerCase() === owner) || cfg.repos.some((r) => r.toLowerCase() === fullName.toLowerCase());
};

// statusCheckRollup.state -> "success" | "failed" | "pending" | null (no checks).
const CI = { SUCCESS: "success", FAILURE: "failed", ERROR: "failed", PENDING: "pending", EXPECTED: "pending" };

const FRAGMENT = `fragment P on PullRequest { number title url isDraft updatedAt mergeable mergeStateStatus baseRefName
  author { login } repository { nameWithOwner }
  commits(last: 1) { nodes { commit { oid statusCheckRollup { state } } } } }`;

const pr = (p) => ({
  key: `${p.repository.nameWithOwner}#${p.number}`,
  repo: p.repository.nameWithOwner, number: p.number, title: p.title, url: p.url,
  author: p.author?.login ?? "", draft: p.isDraft, updated: p.updatedAt,
  mergeable: p.mergeable, mergeState: p.mergeStateStatus, base: p.baseRefName,
  oid: p.commits.nodes[0]?.commit?.oid ?? null,
  ci: CI[p.commits.nodes[0]?.commit?.statusCheckRollup?.state] ?? null,
});

// A pin is a pull request's key, "owner/name#123".
const parsePin = (k) => {
  const m = /^([^/\s]+)\/([^#\s]+)#(\d+)$/.exec(typeof k === "string" ? k : "");
  return m && { owner: m[1], name: m[2], number: Number(m[3]) };
};

const DECISION = { APPROVED: "approved", CHANGES_REQUESTED: "changes" };

// What a pinned pull request adds to P: whether it's still open, its review decision, and the
// last comment or review (to announce someone else's).
const PIN_FIELDS = `state reviewDecision
  timelineItems(last: 1, itemTypes: [ISSUE_COMMENT, PULL_REQUEST_REVIEW]) { nodes {
    ... on IssueComment { id author { login __typename } }
    ... on PullRequestReview { id author { login __typename } } } }`;

// -> { me, reviews: [pr & { team }], prs: [pr], branches: [{ key, repo, branch, oid, url, ci }],
//      pinned: [pr & { state, decision, last } | { key, gone } | { key, unknown }] }
// `gone`: GitHub says the pull request doesn't exist (any more); `unknown`: no answer this time.
export async function overview(cfg, pins = []) {
  const q = `is:pr is:open archived:false ${scope(cfg)}`.trim();
  const branchFields = cfg.branches.map((b, i) => {
    const [owner, name] = b.repo.split("/");
    return `b${i}: repository(owner: ${JSON.stringify(owner)}, name: ${JSON.stringify(name)}) {
      ref(qualifiedName: ${JSON.stringify(`refs/heads/${b.branch}`)}) { target { ... on Commit { oid url statusCheckRollup { state } } } } }`;
  }).join("\n");
  const pinFields = pins.map((k, i) => {
    const p = parsePin(k);
    return p ? `p${i}: repository(owner: ${JSON.stringify(p.owner)}, name: ${JSON.stringify(p.name)}) {
      pullRequest(number: ${p.number}) { ...P ${PIN_FIELDS} } }` : "";
  }).join("\n");
  const query = `${FRAGMENT}
query($mine: String!, $personal: String!, $asked: String!) {
  viewer { login }
  mine: search(query: $mine, type: ISSUE, first: 50) { nodes { ... on PullRequest { ...P } } }
  personal: search(query: $personal, type: ISSUE, first: 50) { nodes { ... on PullRequest { ...P } } }
  asked: search(query: $asked, type: ISSUE, first: 50) { nodes { ... on PullRequest { ...P } } }
  ${branchFields}
  ${pinFields}
}`;
  const out = await gh(["api", "graphql", ...host(cfg), "-f", `query=${query}`,
    "-f", `mine=${q} author:@me`, "-f", `personal=${q} user-review-requested:@me`, "-f", `asked=${q} review-requested:@me`], { partial: true });
  const res = JSON.parse(out);
  const d = res.data;
  if (!d) throw new Error(res.errors?.[0]?.message ?? "GitHub returned no data");

  // review-requested also matches requests to the user's teams: `team` tells them apart.
  const personal = new Set(d.personal.nodes.filter((p) => p.number).map((p) => pr(p).key));
  const reviews = d.asked.nodes.filter((p) => p.number).map((p) => ({ ...pr(p), team: !personal.has(pr(p).key) }));
  for (const p of d.personal.nodes) if (p.number && !reviews.some((r) => r.key === pr(p).key)) reviews.push({ ...pr(p), team: false });

  const branches = cfg.branches.map((b, i) => {
    const t = d[`b${i}`]?.ref?.target;
    return { key: `${b.repo}@${b.branch}`, repo: b.repo, branch: b.branch,
      oid: t?.oid ?? null, url: t?.url ?? `https://${cfg.host}/${b.repo}/tree/${b.branch}`,
      ci: t ? CI[t.statusCheckRollup?.state] ?? null : "missing" };
  });
  // A missing repository or pull request comes back as a NOT_FOUND error on its alias.
  const notFound = new Set((res.errors ?? []).filter((e) => e.type === "NOT_FOUND").map((e) => e.path?.[0]));
  const pinned = pins.map((k, i) => {
    const n = d[`p${i}`]?.pullRequest;
    if (!parsePin(k) || notFound.has(`p${i}`) || (d[`p${i}`] && !n)) return { key: k, gone: true };
    if (!n) return { key: k, unknown: true };
    const last = n.timelineItems?.nodes?.[0];
    return { ...pr(n), state: String(n.state).toLowerCase(), decision: DECISION[n.reviewDecision] ?? null,
      last: last?.id ? { id: last.id, author: last.author?.login ?? "", bot: last.author?.__typename === "Bot" } : null };
  });
  return { me: d.viewer.login, reviews, prs: d.mine.nodes.filter((p) => p.number).map(pr), branches, pinned };
}

// Unread "participating" notifications on pull requests in scope. Review requests come from the
// query above and CI from the checks, so those reasons are left out here.
const SKIP = new Set(["review_requested", "ci_activity"]);

export async function discussions(cfg) {
  const list = JSON.parse(await gh(["api", ...host(cfg), "notifications?participating=true&per_page=50"]));
  return list
    .filter((n) => n.subject?.type === "PullRequest" && !SKIP.has(n.reason) && inScope(cfg, n.repository?.full_name ?? ""))
    .map((n) => {
      const m = /\/repos\/([^/]+\/[^/]+)\/pulls\/(\d+)$/.exec(n.subject.url ?? "");
      return {
        id: n.id, reason: n.reason, title: n.subject.title, updated: n.updated_at,
        repo: n.repository.full_name, number: m ? Number(m[2]) : null,
        url: m ? `https://${cfg.host}/${m[1]}/pull/${m[2]}` : n.repository.html_url,
      };
    });
}

// What a recap needs beyond P (recap.js): who's still asked, the latest reviews and the teams they
// count for, the review threads with who started them and who spoke last, and the last commits (to
// tell a push since your review from a rebase or a merge of the base branch).
const DETAIL_FIELDS = `
  reviewRequests(first: 20) { nodes { requestedReviewer { __typename ... on User { login } ... on Team { slug } } } }
  latestOpinionatedReviews(first: 20) { nodes { state author { login __typename } commit { oid } onBehalfOf(first: 5) { nodes { slug } } } }
  latestReviews(first: 20) { nodes { state submittedAt author { login __typename } commit { oid } } }
  commits(last: 50) { nodes { commit { oid authoredDate parents { totalCount } } } }
  reviewThreads(first: 50) { totalCount nodes { isResolved
    first: comments(first: 1) { nodes { author { login __typename } } }
    last: comments(last: 1) { nodes { author { login __typename } } } } }`;

// keys ("owner/name#123") -> { [key]: details | null }: one alias per pull request. null when it
// couldn't be read this time (gone, no answer, or not a pull request's key): the caller keeps what
// it had. With no valid key there's nothing to ask (an empty query is an error).
export async function details(cfg, keys) {
  const fields = keys.map((k, i) => {
    const p = parsePin(k);
    return p && `d${i}: repository(owner: ${JSON.stringify(p.owner)}, name: ${JSON.stringify(p.name)}) {
      pullRequest(number: ${p.number}) { ${DETAIL_FIELDS} } }`;
  }).filter(Boolean).join("\n");
  if (!fields) return Object.fromEntries(keys.map((k) => [k, null]));
  const res = JSON.parse(await gh(["api", "graphql", ...host(cfg), "-f", `query=query { ${fields} }`], { partial: true }));
  if (!res.data) throw new Error(res.errors?.[0]?.message ?? "GitHub returned no data");
  return Object.fromEntries(keys.map((k, i) => [k, res.data[`d${i}`]?.pullRequest ?? null]));
}
