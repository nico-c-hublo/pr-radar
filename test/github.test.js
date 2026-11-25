import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";

// github.js imports Herdr's `herdr` module, which only exists inside Herdr: answer it with a fake.
const fake = new URL("./fakes/herdr.js", import.meta.url).href;
registerHooks({ resolve: (specifier, context, next) => (specifier === "herdr" ? { url: fake, shortCircuit: true } : next(specifier, context)) });
const { details, myTeams, overview, discussions, ownThreads } = await import("../mods/pr-radar/github.js");
const { readConfig } = await import("../mods/pr-radar/config.js");
const herdr = await import(fake);

const cfg = { host: "github.com", orgs: [], repos: [], branches: [] };
const query = () => herdr.calls[0].args.find((a) => a.startsWith("query=")).slice("query=".length);
beforeEach(() => { herdr.calls.length = 0; });

test("details: no key worth asking about, no query (an empty one is an error)", async () => {
  assert.deepEqual(await details(cfg, ["not a key", ""]), { "not a key": null, "": null });
  assert.deepEqual(await details(cfg, []), {});
  assert.equal(herdr.calls.length, 0);
});

test("details: one alias per valid key; an invalid one comes back null", async () => {
  herdr.answer({ stdout: JSON.stringify({ data: { d1: { pullRequest: { reviewRequests: { nodes: [] } } } } }) });
  const got = await details(cfg, ["junk", "acme/web#12"]);
  assert.equal(herdr.calls.length, 1);
  assert.match(query(), /d1: repository\(owner: "acme", name: "web"\)/);
  assert.match(query(), /pullRequest\(number: 12\)/);
  assert.doesNotMatch(query(), /d0:/);
  assert.deepEqual(got, { junk: null, "acme/web#12": { reviewRequests: { nodes: [] } } });
});

test("details: a pull request that's gone comes back null, the others still count", async () => {
  herdr.answer({ code: 1, stdout: JSON.stringify({ data: { d0: { pullRequest: null }, d1: { pullRequest: { x: 1 } } }, errors: [{ type: "NOT_FOUND", path: ["d0"] }] }) });
  assert.deepEqual(await details(cfg, ["acme/web#1", "acme/web#2"]), { "acme/web#1": null, "acme/web#2": { x: 1 } });
});

test("myTeams: your teams in every org, as org/slug", async () => {
  herdr.answer({ stdout: JSON.stringify({ data: { viewer: { organizations: { nodes: [
    { login: "acme", teams: { nodes: [{ slug: "planning" }, { slug: "api" }] } },
    { login: "other", teams: { nodes: [] } },
  ] } } } }) });
  assert.deepEqual(await myTeams(cfg, "me"), ["acme/planning", "acme/api"]);
  assert.ok(herdr.calls[0].args.includes("login=me"));
});

test("myTeams: an error (a token without read:org) is thrown, for the caller to keep what it had", async () => {
  herdr.answer({ code: 1, stdout: "", stderr: "Your token has not been granted the required scopes" });
  await assert.rejects(myTeams(cfg, "me"), /required scopes/);
});

test("details: a thread's last comment is kept to 280 characters", async () => {
  const body = "x".repeat(1000);
  herdr.answer({ stdout: JSON.stringify({ data: { d0: { pullRequest: { reviewThreads: { nodes: [{ last: { nodes: [{ bodyText: body }] } }] } } } } }) });
  const got = await details(cfg, ["acme/web#1"]);
  assert.equal(got["acme/web#1"].reviewThreads.nodes[0].last.nodes[0].bodyText.length, 280);
  assert.match(query(), /bodyText/);
});

const empty = { data: { viewer: { login: "me" }, mine: { nodes: [] }, personal: { nodes: [] }, asked: { nodes: [] } } };
const arg = (name) => herdr.calls[0].args.find((a) => a.startsWith(`${name}=`)).slice(name.length + 1);

test("readConfig: myPrs is \"scope\" unless \"everywhere\", and it's part of the state's id", () => {
  assert.equal(readConfig({}).myPrs, "scope");
  assert.equal(readConfig({ myPrs: "yes" }).myPrs, "scope");
  assert.equal(readConfig({ myPrs: "everywhere" }).myPrs, "everywhere");
  assert.notEqual(readConfig({ orgs: ["acme"] }).id, readConfig({ orgs: ["acme"], myPrs: "everywhere" }).id);
});

test("overview: your pull requests are searched in the scope by default", async () => {
  herdr.answer({ stdout: JSON.stringify(empty) });
  await overview(readConfig({ orgs: ["acme"] }));
  assert.equal(arg("mine"), "is:pr is:open archived:false org:acme author:@me");
  assert.equal(arg("asked"), "is:pr is:open archived:false org:acme review-requested:@me");
});

test("overview: with myPrs everywhere, only your own pull requests leave the scope", async () => {
  herdr.answer({ stdout: JSON.stringify(empty) });
  await overview(readConfig({ orgs: ["acme"], myPrs: "everywhere" }));
  assert.equal(arg("mine"), "is:pr is:open archived:false author:@me");
  assert.equal(arg("personal"), "is:pr is:open archived:false org:acme user-review-requested:@me");
  assert.equal(arg("asked"), "is:pr is:open archived:false org:acme review-requested:@me");
});

const notification = (id, repo, number) => ({ id, reason: "comment", updated_at: "2026-11-25T10:00:00Z",
  subject: { type: "PullRequest", title: `#${number}`, url: `https://api.github.com/repos/${repo}/pulls/${number}` },
  repository: { full_name: repo, html_url: `https://github.com/${repo}` } });

test("discussions: out of scope, dropped by default; kept and marked with myPrs everywhere", async () => {
  const list = [notification("1", "acme/web", 1), notification("2", "someone/tool", 7)];
  herdr.answer({ stdout: JSON.stringify(list) });
  assert.deepEqual((await discussions(readConfig({ orgs: ["acme"] }))).map((t) => t.id), ["1"]);
  herdr.calls.length = 0;
  herdr.answer({ stdout: JSON.stringify(list) });
  const got = await discussions(readConfig({ orgs: ["acme"], myPrs: "everywhere" }));
  assert.deepEqual(got.map((t) => [t.id, t.outside ?? false]), [["1", false], ["2", true]]);
});

test("ownThreads: keeps threads in scope, and those outside it on your own pull requests", () => {
  const threads = [
    { id: "1", repo: "acme/web", number: 1 },
    { id: "2", repo: "someone/tool", number: 7, outside: true },
    { id: "3", repo: "someone/other", number: 9, outside: true },
  ];
  assert.deepEqual(ownThreads(threads, [{ key: "someone/tool#7" }]), [
    { id: "1", repo: "acme/web", number: 1 },
    { id: "2", repo: "someone/tool", number: 7 },
  ]);
});
