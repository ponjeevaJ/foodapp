import { calculateFinalPrice } from "./calculateFinalPrice.mjs";

export function cheapestOption(options) {
  return options.reduce((current, option) => {
    if (!current || calculateFinalPrice(option) < calculateFinalPrice(current)) return option;
    return current;
  }, null);
}

export function savingsBetween(options) {
  if (options.length < 2) return 0;
  const totals = options.map(calculateFinalPrice);
  return Number((Math.max(...totals) - Math.min(...totals)).toFixed(2));
}
