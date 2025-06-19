require('dotenv').config();
const { getPrices } = require('./datafeeds');
const strategy = require('./strategy');
const trade = require('./trade');
const risk = require('./risk');
const fs = require('fs');
const config = require('./config');
const indicators = require('./indicators');

let history = [];
let paper = true; // default to paper trading

function logTrade(side, token, amount, price) {
  const trades = JSON.parse(fs.readFileSync('./logs/trades.json'));
  trades.push({ time: new Date().toISOString(), side, token, amount, price });
  fs.writeFileSync('./logs/trades.json', JSON.stringify(trades, null, 2));
}

async function loop() {
  const prices = await getPrices();
  if (!prices) return;
  for (const symbol of config.TOKENS) {
    const price = prices[symbol.toLowerCase()];
    if (!price) continue;
    console.log(`\u23f1 Checking ${symbol} at $${price}`);
    history.push({ time: Date.now(), close: price });
    if (history.length > 100) history.shift();
    const closing = history.map(h => h.close);
    const rsiValues = indicators.rsi(closing, config.RSI_PERIOD).slice(-1)[0];
    const macdValues = indicators.macd(closing).slice(-1)[0];
    const boll = indicators.bollinger(closing, config.BOLLINGER_PERIOD).slice(-1)[0];
    console.log(`\ud83d\udcc8 RSI/MACD/Bollinger: ${rsiValues}/${macdValues?.MACD}/${boll?.lower}-${boll?.upper}`);
    const score = strategy.scoreSignals(history);
    if (strategy.shouldBuy(score)) {
      console.log(`\ud83d\udfe2 Signal: BUY ${symbol}`);
      if (paper) {
        console.log(`\ud83e\uddea PAPER TRADE: Simulated BUY ${symbol} at $${price}`);
      } else {
        await trade.buy(0.01, []); // placeholder path
        risk.updateEntry(price);
        logTrade('BUY', symbol, 0.01, price);
      }
    } else if (strategy.shouldSell && strategy.shouldSell(score)) {
      console.log(`\ud83d\dd34 Signal: SELL ${symbol}`);
      if (paper) {
        console.log(`\ud83e\uddea PAPER TRADE: Simulated SELL ${symbol} at $${price}`);
      } else {
        await trade.sell(0.01, []); // placeholder path
        logTrade('SELL', symbol, 0.01, price);
      }
    }
    if (risk.stopLoss(price) || risk.takeProfit(price)) {
      if (paper) {
        console.log(`\ud83e\uddea PAPER TRADE: Simulated SELL ${symbol} at $${price}`);
      } else {
        await trade.sell(0.01, []); // placeholder path
      }
      logTrade('SELL', symbol, 0.01, price);
    }
  }
}

function main() {
  console.log("\ud83d\ude80 Bot started.");
  setInterval(loop, 60 * 1000);
}

main();
