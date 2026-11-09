// Every string PR Radar shows, in English and French. `ref` is "owner/name#123".

const en = {
  reviewRequested: (ref) => `Review requested: ${ref}`,
  teamReviewRequested: (ref) => `Review requested of your team: ${ref}`,
  ciFailed: (ref) => `CI failed: ${ref}`,
  ciGreen: (ref) => `CI passed: ${ref}`,
  branchBroken: (b) => `${b} is broken`,
  branchBrokenBody: "The branch's checks failed",
  branchFixed: (b) => `${b} is fixed`,
  branchFixedBody: "The branch's checks pass again",
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
  sections: { reviews: "Reviews requested", ci: "My pull requests", branches: "Branches", discussions: "Unread discussions", team: "Reviews requested of my teams" },
  empty: { reviews: "No review waiting on you", ci: "No open pull request", branches: "None watched", discussions: "Nothing new", team: "None" },
  ci: { success: "Checks pass", failed: "Checks failed", pending: "Checks running", none: "No checks", missing: "Branch not found" },
  team: "team", draft: "draft",
  units: ["min", "h", "d"],
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
  sections: { reviews: "Reviews demandées", ci: "Mes PR", branches: "Branches", discussions: "Discussions non lues", team: "Reviews demandées à mes équipes" },
  empty: { reviews: "Aucune review en attente", ci: "Aucune PR ouverte", branches: "Aucune surveillée", discussions: "Rien de nouveau", team: "Aucune" },
  ci: { success: "Checks verts", failed: "Checks rouges", pending: "Checks en cours", none: "Pas de checks", missing: "Branche introuvable" },
  team: "équipe", draft: "draft",
  units: ["min", "h", "j"],
};

export const strings = (lang) => (lang === "fr" ? fr : en);
