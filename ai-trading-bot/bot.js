require('dotenv').config();
const { getPrice } = require('./datafeeds');
const strategy = require('./strategy');
const trade = require('./trade');
const risk = require('./risk');
const fs = require('fs');
const config = require('./config');

let history = [];
let paper = true; // default to paper trading

async function loop() {
  for (const symbol of config.TOKENS) {
    const price = await getPrice(symbol);
    if (!price) continue;
    history.push({ time: Date.now(), close: price });
    if (history.length > 100) history.shift();
    const score = strategy.scoreSignals(history);
    if (strategy.shouldBuy(score) && !paper) {
      await trade.buy(0.01, []); // placeholder path
      risk.updateEntry(price);
      logTrade('BUY', symbol, 0.01, price);
    }
    if (risk.stopLoss(price) || risk.takeProfit(price)) {
      if (!paper) {
        await trade.sell(0.01, []); // placeholder path
      }
      logTrade('SELL', symbol, 0.01, price);
    }
  }
}

function logTrade(side, token, amount, price) {
  const trades = JSON.parse(fs.readFileSync('./logs/trades.json'));
  trades.push({ time: new Date().toISOString(), side, token, amount, price });
  fs.writeFileSync('./logs/trades.json', JSON.stringify(trades, null, 2));
}

setInterval(loop, 60 * 1000);
