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

function calculatePositionSize(score, capital) {
  const percent = score * 0.05;
  const usd = capital * percent;
  return usd < 10 ? 0 : usd;
}
module.exports = { updateEntry, stopLoss, takeProfit, getEntry, calculatePositionSize };
