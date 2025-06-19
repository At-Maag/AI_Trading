let entryPrice = null;

function updateEntry(price) {
  entryPrice = price;
}

function stopLoss(price) {
  if (entryPrice && price < entryPrice * (1 - 0.05)) return true;
  return false;
}

function takeProfit(price) {
  if (entryPrice && price > entryPrice * (1 + 0.1)) return true;
  return false;
}

module.exports = { updateEntry, stopLoss, takeProfit };
