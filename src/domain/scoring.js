const WEIGHTS = {
  "Best overall": { price: 40, rating: 25, delivery: 20, reliability: 10, distance: 5 },
  Cheapest: { price: 70, rating: 10, delivery: 10, reliability: 5, distance: 5 },
  Fastest: { price: 20, rating: 15, delivery: 50, reliability: 10, distance: 5 },
  "Best rated": { price: 20, rating: 50, delivery: 15, reliability: 10, distance: 5 }
};

function scaledScores(values, lowerIsBetter) {
  const numbers = values.map((value) => Number.isFinite(value) ? value : 0);
  const low = Math.min(...numbers);
  const high = Math.max(...numbers);
  if (high === low) return numbers.map(() => 100);
  return numbers.map((value) => {
    const normalized = (value - low) / (high - low);
    return Number(((lowerIsBetter ? 1 - normalized : normalized) * 100).toFixed(2));
  });
}

function confidenceAdjustedRating(option) {
  const priorCount = 100;
  const priorRating = 4.2;
  return (
    option.rating * option.ratingCount / (option.ratingCount + priorCount) +
    priorRating * priorCount / (option.ratingCount + priorCount)
  );
}

function reliabilityScore(option) {
  if (!option.isOpen) return 0;
  const reliability = option.reliability || {};
  const cancellationRate = Math.min(1, Math.max(0, reliability.cancellationRate || 0));
  const lateRate = Math.min(1, Math.max(0, reliability.lateRate || 0));
  return Number(((1 - cancellationRate * 0.65 - lateRate * 0.35) * 100).toFixed(2));
}

function scoreOptions(options, priority = "Best overall") {
  if (!WEIGHTS[priority]) throw new RangeError(`Unsupported priority: ${priority}`);
  if (options.length === 0) return [];

  const criteria = {
    price: scaledScores(options.map((option) => option.finalTotal), true),
    rating: scaledScores(options.map(confidenceAdjustedRating), false),
    delivery: scaledScores(options.map((option) => option.etaMinutes), true),
    reliability: options.map(reliabilityScore),
    distance: scaledScores(options.map((option) => option.distanceKm), true)
  };
  const weights = WEIGHTS[priority];

  return options.map((option, index) => {
    const components = Object.fromEntries(
      Object.entries(criteria).map(([key, scores]) => [key, scores[index]])
    );
    const score = Number(Object.entries(weights)
      .reduce((total, [key, weight]) => total + components[key] * weight / 100, 0)
      .toFixed(2));
    return { ...option, score, scoreBreakdown: components };
  }).sort((a, b) => b.score - a.score || a.finalTotal - b.finalTotal);
}

module.exports = { WEIGHTS, scoreOptions };
