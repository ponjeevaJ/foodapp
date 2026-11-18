const searchConfig = require("../data/searchSynonyms.json");

function normalizeText(value) {
  return String(value || "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function sanitizeFood(value) {
  if (typeof value !== "string") return "";
  const withoutScripts = value.replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, " ");
  const withoutMarkup = withoutScripts.replace(/<[^>]*>|[<>`]/g, " ");
  return Array.from(withoutMarkup.normalize("NFKC").replace(/\s+/g, " ").trim())
    .slice(0, 60)
    .join("")
    .trim();
}

function canonicalizeFood(value) {
  let normalized = normalizeText(value);
  const aliases = searchConfig.groups
    .flatMap((group) => group.terms.map((term) => ({
      term: normalizeText(term),
      canonical: normalizeText(group.canonical)
    })))
    .sort((a, b) => b.term.length - a.term.length);

  for (const alias of aliases) {
    if (alias.term.includes(" ") && normalized !== alias.term) continue;
    const escaped = alias.term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const phrase = new RegExp(`(^| )${escaped}(?= |$)`, "g");
    normalized = normalized.replace(phrase, `$1${alias.canonical}`);
  }
  return normalized.replace(/\s+/g, " ").trim();
}

function levenshteinDistance(left, right) {
  const a = Array.from(left);
  const b = Array.from(right);
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    for (let j = 1; j <= b.length; j += 1) {
      current[j] = Math.min(
        current[j - 1] + 1,
        previous[j] + 1,
        previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
    }
    previous = current;
  }
  return previous[b.length];
}

function fuzzyScore(query, candidate) {
  const left = canonicalizeFood(query);
  const right = canonicalizeFood(candidate);
  if (!left || !right) return 0;
  if (left === right) return 1;
  if ((left.includes(right) || right.includes(left)) && Math.min(left.length, right.length) >= 3) {
    return 0.9;
  }

  const leftTokens = new Set(left.split(" "));
  const rightTokens = new Set(right.split(" "));
  const overlap = [...leftTokens].filter((token) => rightTokens.has(token)).length;
  const tokenScore = leftTokens.size + rightTokens.size === 0
    ? 0
    : (2 * overlap) / (leftTokens.size + rightTokens.size);
  const queryCoverage = [...leftTokens].reduce((score, token) => {
    const bestMatch = Math.max(...[...rightTokens].map((candidateToken) =>
      1 - levenshteinDistance(token, candidateToken) / Math.max(token.length, candidateToken.length)
    ));
    return score + bestMatch;
  }, 0) / leftTokens.size;
  const characterScore = 1 - levenshteinDistance(left, right) / Math.max(left.length, right.length);
  return Math.max(tokenScore, queryCoverage, characterScore);
}

function matchesFood(query, candidate, threshold = 0.45) {
  return fuzzyScore(query, candidate) >= threshold;
}

function getSuggestions(query, candidates, limit = 8, minimumScore = 0.35) {
  const uniqueCandidates = [...new Set([
    ...searchConfig.popularDishes,
    ...candidates
  ])];
  if (!query) return uniqueCandidates.slice(0, limit);
  const ranked = uniqueCandidates
    .map((dish) => ({ dish, score: fuzzyScore(query, dish) }))
    .filter((entry) => entry.score >= minimumScore)
    .sort((a, b) => b.score - a.score || a.dish.localeCompare(b.dish));
  const suggestions = ranked.map((entry) => entry.dish);
  return suggestions.slice(0, limit);
}

module.exports = {
  canonicalizeFood,
  fuzzyScore,
  getSuggestions,
  matchesFood,
  normalizeText,
  sanitizeFood
};
