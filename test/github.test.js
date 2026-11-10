import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";

// github.js imports Herdr's `herdr` module, which only exists inside Herdr: answer it with a fake.
const fake = new URL("./fakes/herdr.js", import.meta.url).href;
registerHooks({ resolve: (specifier, context, next) => (specifier === "herdr" ? { url: fake, shortCircuit: true } : next(specifier, context)) });
const { details } = await import("../mods/pr-radar/github.js");
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
