// Every string PR Radar shows, in English and French. `ref` is "owner/name#123".

// "a", "a and b", "a, b and c", "a, b, c and 2 more". In a recap the viewer is "you" (recap.js);
// French says "toi".
const LIST_MAX = 3;
const list = (xs, and, more = (n) => `${n} more`) => {
  const shown = xs.length > LIST_MAX ? [...xs.slice(0, LIST_MAX), more(xs.length - LIST_MAX)] : xs;
  return shown.length < 2 ? shown.join("") : `${shown.slice(0, -1).join(", ")} ${and} ${shown[shown.length - 1]}`;
};
const autres = (n) => `${n} autre${n === 1 ? "" : "s"}`;
const toi = (who) => (who === "you" ? "toi" : who);

const en = {
  reviewRequested: (ref) => `Review requested: ${ref}`,
  teamReviewRequested: (ref) => `Review requested of your team: ${ref}`,
  ciFailed: (ref) => `CI failed: ${ref}`,
  ciGreen: (ref) => `CI passed: ${ref}`,
  branchBroken: (b) => `${b} is broken`,
  branchBrokenBody: "The branch's checks failed",
  branchFixed: (b) => `${b} is fixed`,
  branchFixedBody: "The branch's checks pass again",
  merged: (ref) => `Merged: ${ref}`,
  closed: (ref) => `Closed: ${ref}`,
  approved: (ref) => `Approved: ${ref}`,
  changesRequested: (ref) => `Changes requested: ${ref}`,
  newCommits: (ref) => `New commits: ${ref}`,
  newComment: (ref) => `New comment: ${ref}`,
  reasons: {
    author: "Activity on your PR", comment: "New comment", mention: "You were mentioned",
    team_mention: "Your team was mentioned", assign: "Assigned to you", state_change: "PR changed",
    manual: "Subscribed", subscribed: "Subscribed",
  },
  activity: "Activity",
  testTitle: "PR Radar test", testBody: "Click to open GitHub",
  loading: "GitHub…", error: "⚠ GitHub",
  reviews: (n) => `${n} review${n === 1 ? "" : "s"}`,
  title: "PR Radar", updated: (ago) => (ago === "just now" ? "updated just now" : `updated ${ago} ago`), now: "just now", refresh: "Refresh", waiting: "loading…",
  sections: { pinned: "Pinned", reviews: "Reviews requested", ci: "My pull requests", branches: "Branches", discussions: "Unread discussions", team: "Reviews requested of my teams" },
  empty: { reviews: "No review waiting on you", ci: "No open pull request", branches: "None watched", discussions: "Nothing new", team: "None" },
  ci: { success: "Checks pass", failed: "Checks failed", pending: "Checks running", none: "No checks", missing: "Branch not found" },
  team: "team", draft: "draft", review: "review",
  decision: { approved: "approved", changes: "changes requested" },
  units: ["min", "h", "d"],
  recap: {
    waitingOnMe: (n) => `${n} thread${n === 1 ? "" : "s"} wait${n === 1 ? "s" : ""} on you`,
    conflicts: (base) => `conflicts with ${base}`,
    answered: (author, n) => `${author} answered your ${n === 1 ? "thread" : `${n} threads`}`,
    pushed: "pushed since your review",
    rebased: "rebased since your review",
    changesRequested: (by) => `changes requested by ${list(by, "and")}`,
    ciRed: "CI red",
    behind: (base) => `behind ${base}`,
    ready: "ready to merge",
    // mine: the viewer's teams among them ("your team").
    waitingOn: (teams, users, mine = []) => `waiting on ${list([...teams.map((t) => (mine.includes(t) ? `your team ${t}` : `team ${t}`)), ...users], "and")}`,
    // mine: the viewer's teams among them ("your team").
    approved: (a, mine = []) => (a.length === 1
      ? `${a[0].by} approved${a[0].teams.length ? ` for ${list(a[0].teams.map((t) => (mine.includes(t) ? `your team ${t}` : `team ${t}`)), "and")}` : ""}`
      : `approved by ${list(a.map((x) => (x.teams.length ? `${x.by} (${x.teams.map((t) => (mine.includes(t) ? `your team ${t}` : t)).join(", ")})` : x.by)), "and")}`),
    nothingNew: "nothing new since your review",
    unstable: "mergeable · some optional checks fail",
    noReviewers: "no reviewers yet",
    needsApproval: "needs another approval",
    said: (by, text) => `${by}: "${text}"`,
    draftNoReviewers: "draft · no reviewers yet",
  },
};

const fr = {
  reviewRequested: (ref) => `Review demandée : ${ref}`,
  teamReviewRequested: (ref) => `Review demandée à ton équipe : ${ref}`,
  ciFailed: (ref) => `CI rouge : ${ref}`,
  ciGreen: (ref) => `CI verte : ${ref}`,
  branchBroken: (b) => `${b} est cassée`,
  branchBrokenBody: "Les checks de la branche ont échoué",
  branchFixed: (b) => `${b} est réparée`,
  branchFixedBody: "Les checks de la branche repassent au vert",
  merged: (ref) => `Mergée : ${ref}`,
  closed: (ref) => `Fermée : ${ref}`,
  approved: (ref) => `Approuvée : ${ref}`,
  changesRequested: (ref) => `Changements demandés : ${ref}`,
  newCommits: (ref) => `Nouveaux commits : ${ref}`,
  newComment: (ref) => `Nouveau commentaire : ${ref}`,
  reasons: {
    author: "Activité sur ta PR", comment: "Nouveau commentaire", mention: "Tu es mentionné",
    team_mention: "Ton équipe est mentionnée", assign: "PR assignée", state_change: "PR changée",
    manual: "PR suivie", subscribed: "PR suivie",
  },
  activity: "Activité",
  testTitle: "Test PR Radar", testBody: "Clique pour ouvrir GitHub",
  loading: "GitHub…", error: "⚠ GitHub",
  reviews: (n) => `${n} review${n === 1 ? "" : "s"}`,
  title: "PR Radar", updated: (ago) => (ago === "à l'instant" ? "mis à jour à l'instant" : `mis à jour il y a ${ago}`), now: "à l'instant", refresh: "Rafraîchir", waiting: "chargement…",
  sections: { pinned: "Épinglées", reviews: "Reviews demandées", ci: "Mes PR", branches: "Branches", discussions: "Discussions non lues", team: "Reviews demandées à mes équipes" },
  empty: { reviews: "Aucune review en attente", ci: "Aucune PR ouverte", branches: "Aucune surveillée", discussions: "Rien de nouveau", team: "Aucune" },
  ci: { success: "Checks verts", failed: "Checks rouges", pending: "Checks en cours", none: "Pas de checks", missing: "Branche introuvable" },
  team: "équipe", draft: "draft", review: "review",
  decision: { approved: "approuvée", changes: "changements demandés" },
  units: ["min", "h", "j"],
  recap: {
    waitingOnMe: (n) => `${n} fil${n === 1 ? "" : "s"} attend${n === 1 ? "" : "ent"} ta réponse`,
    conflicts: (base) => `conflits avec ${base}`,
    answered: (author, n) => `${author} a répondu à ${n === 1 ? "ton fil" : `tes ${n} fils`}`,
    pushed: "nouveaux commits depuis ta review",
    rebased: "rebasée depuis ta review",
    changesRequested: (by) => `changements demandés par ${list(by.map(toi), "et", autres)}`,
    ciRed: "CI rouge",
    behind: (base) => `en retard sur ${base}`,
    ready: "prête à merger",
    waitingOn: (teams, users, mine = []) => `en attente de ${list([...teams.map((t) => (mine.includes(t) ? `ton équipe ${t}` : `l'équipe ${t}`)), ...users.map(toi)], "et", autres)}`,
    approved: (a, mine = []) => (a.length === 1
      ? `${a[0].by === "you" ? "tu as approuvé" : `${a[0].by} a approuvé`}${a[0].teams.length ? ` pour ${list(a[0].teams.map((t) => (mine.includes(t) ? `ton équipe ${t}` : `l'équipe ${t}`)), "et", autres)}` : ""}`
      : `approuvée par ${list(a.map((x) => (x.teams.length ? `${toi(x.by)} (${x.teams.map((t) => (mine.includes(t) ? `ton équipe ${t}` : t)).join(", ")})` : toi(x.by))), "et", autres)}`),
    nothingNew: "rien de nouveau depuis ta review",
    unstable: "mergeable · des checks optionnels échouent",
    noReviewers: "pas encore de reviewers",
    needsApproval: "il manque une approbation",
    said: (by, text) => `${by} : « ${text} »`,
    draftNoReviewers: "draft · pas encore de reviewers",
  },
};

export const strings = (lang) => (lang === "fr" ? fr : en);
