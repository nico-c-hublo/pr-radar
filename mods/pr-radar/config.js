// PR Radar's configuration: the `props` of its block in the layout. Every field is optional;
// with none, it watches every repository you're involved in.
//
//   { "mod": "pr-radar", "props": {
//       "orgs": ["my-org"],                      // only pull requests in these orgs (or users)…
//       "repos": ["someone/tool"],               // …and these repositories; both empty: everywhere
//       "branches": ["my-org/app@main"],         // branches whose CI to watch ("owner/name@branch"
//                                                //   or { "repo": "owner/name", "branch": "main" })
//       "host": "github.com",                    // a GitHub Enterprise host, as gh knows it
//       "interval": 60,                          // seconds between checks (30 at least)
//       "sound": "needs-you",                    // "needs-you" (review asked, CI red) | "always" | "never"
//       "teamReviews": false,                    // also announce reviews asked of your teams
//       "greenCi": true,                         // announce a pull request's CI turning green
//       "lang": "en",                            // "en" | "fr"
//       "demo": false                            // made-up data, no network (for screenshots)
//   } }

const list = (v) => (Array.isArray(v) ? v : typeof v === "string" && v ? [v] : []).map((x) => (typeof x === "string" ? x.trim() : x)).filter(Boolean);

function branch(b) {
  if (typeof b === "string") {
    const m = /^([^/\s]+\/[^@\s]+)@(.+)$/.exec(b);
    return m ? { repo: m[1], branch: m[2] } : null;
  }
  return b && typeof b.repo === "string" && b.repo.includes("/") && typeof b.branch === "string" ? { repo: b.repo, branch: b.branch } : null;
}

export function readConfig(props) {
  const p = props ?? {};
  const branches = list(p.branches).map(branch);
  const cfg = {
    orgs: list(p.orgs).filter((o) => typeof o === "string"),
    repos: list(p.repos).filter((r) => typeof r === "string" && r.includes("/")),
    branches: branches.filter(Boolean),
    host: typeof p.host === "string" && p.host ? p.host : "github.com",
    interval: Math.max(30, Number(p.interval) || 60),
    sound: ["needs-you", "always", "never"].includes(p.sound) ? p.sound : "needs-you",
    teamReviews: p.teamReviews === true,
    greenCi: p.greenCi !== false,
    lang: p.lang === "fr" ? "fr" : "en",
    demo: p.demo === true,
    problems: branches.some((b) => !b) ? ["branches: use \"owner/name@branch\""] : [],
  };
  // State is kept per scope, so two copies watching different things don't mix.
  cfg.id = JSON.stringify([cfg.host, cfg.orgs, cfg.repos, cfg.branches.map((b) => `${b.repo}@${b.branch}`), cfg.demo]);
  return cfg;
}
