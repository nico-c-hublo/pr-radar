// A stand-in for Herdr's `herdr` module in tests: exec records its calls and answers what the test
// set with `answer`. Only what github.js uses.
export const calls = [];
let next = { code: 0, stdout: "{}", stderr: "" };
export const answer = (r) => { next = { code: 0, stderr: "", ...r }; };
export async function exec(bin, args) { calls.push({ bin, args }); return next; }
