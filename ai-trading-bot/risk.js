const config = require('./config');

let entryPrice = {};
let highWater = {};

function updateEntry(symbol, price) {
  entryPrice[symbol] = price;
  highWater[symbol] = price;
}

function getEntry(symbol) {
  return entryPrice[symbol] || null;
}

function stopLoss(symbol, price) {
  if (entryPrice[symbol] && price < entryPrice[symbol] * (1 - config.STOP_LOSS)) {
    return true;
  }
  return false;
}

function takeProfit(symbol, price) {
  if (!entryPrice[symbol]) return false;
  if (price > highWater[symbol]) highWater[symbol] = price;
  const trailing = highWater[symbol] * (1 - config.TRAILING_STOP);
  if (price >= entryPrice[symbol] * (1 + config.TAKE_PROFIT)) return true;
  if (price < trailing && price > entryPrice[symbol]) return true;
  return false;
}

function calculatePositionSize(score, ethBalance, ethPrice) {
  ethPrice = ethPrice || 3500;
  const s = Math.max(1, Math.min(score, 3));
  const allocation = 0.2 * (s / 3); // max 20% of wallet when score is 3
  const amountEth = ethBalance * allocation;
  if (amountEth * ethPrice < 10 || amountEth < 0.0045) return 0;
  return amountEth;
}
module.exports = { updateEntry, stopLoss, takeProfit, getEntry, calculatePositionSize };
