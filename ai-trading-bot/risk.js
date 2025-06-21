const config = require('./config');

let entryPrice = null;
let highWater = null;

function updateEntry(price) {
  entryPrice = price;
  highWater = price;
}

function stopLoss(price) {
  if (entryPrice && price < entryPrice * (1 - config.STOP_LOSS)) return true;
  return false;
}

function takeProfit(price) {
  if (!entryPrice) return false;
  if (price > highWater) highWater = price;
  const trailing = highWater * (1 - config.TRAILING_STOP);
  if (price >= entryPrice * (1 + config.TAKE_PROFIT)) return true;
  if (price < trailing && price > entryPrice) return true;
  return false;
}

module.exports = { updateEntry, stopLoss, takeProfit };
