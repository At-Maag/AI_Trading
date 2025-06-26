const STOP_LOSS = 0.04;
const TAKE_PROFIT = 0.08;
const TRAILING_STOP = 0.02;
const TRADE_ALLOCATION = 0.15;

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
  if (entryPrice[symbol] && price < entryPrice[symbol] * (1 - STOP_LOSS)) {
    return true;
  }
  return false;
}

function takeProfit(symbol, price) {
  if (!entryPrice[symbol]) return false;
  if (price > highWater[symbol]) highWater[symbol] = price;
  const trailing = highWater[symbol] * (1 - TRAILING_STOP);
  if (price >= entryPrice[symbol] * (1 + TAKE_PROFIT)) return true;
  if (price < trailing && price > entryPrice[symbol]) return true;
  return false;
}

function calculatePositionSize(score, ethBalance, ethPrice) {
  ethPrice = ethPrice || 3500;
  const allocation = TRADE_ALLOCATION;
  const amountEth = ethBalance * allocation;
  if (amountEth * ethPrice < 10 || amountEth <= 0) return 0;
  return amountEth;
}
module.exports = { updateEntry, stopLoss, takeProfit, getEntry, calculatePositionSize };
