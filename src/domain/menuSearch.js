const { canonicalizeFood, fuzzyScore, normalizeText } = require("./search");

const SIMILARITY_THRESHOLD = 0.78;

function findMenuMatches(query, menu, mode = "strict") {
  const normalizedQuery = canonicalizeFood(query);
  if (!normalizedQuery) return [];

  if (mode === "fuzzy") {
    return menu.flatMap((item) => {
      const score = fuzzyScore(normalizedQuery, `${item.itemName} ${item.category}`);
      return score >= SIMILARITY_THRESHOLD
        ? [{ item, matchType: "fuzzy", matchScore: score }]
        : [];
    });
  }

  const exact = menu.filter((item) => canonicalizeFood(item.itemName) === normalizedQuery);
  if (exact.length) return exact.map((item) => ({ item, matchType: "exact" }));

  const queryWords = normalizeText(normalizedQuery).split(/\s+/).filter(Boolean);
  return menu.flatMap((item) => {
    const searchableText = normalizeText(`${item.itemName} ${item.category}`);
    return queryWords.every((word) => searchableText.split(/\s+/).includes(word))
      ? [{ item, matchType: "all-words" }]
      : [];
  });
}

module.exports = { findMenuMatches, SIMILARITY_THRESHOLD };
