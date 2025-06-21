require('dotenv').config();
const { getPrices } = require('./datafeeds');
const strategy = require('./strategy');
const trade = require('./trade');
const risk = require('./risk');
const fs = require('fs');
const path = require('path');
const config = require('./config');

// Maintain an in-memory price history for each token
const history = {};
let paper = true; // default to paper trading
let activeTrades = {};

const logFile = path.join(__dirname, '..', 'data', 'trade-log.json');

function logTrade(side, token, amount, price, reason, pnlPct) {
  let trades = [];
  try { trades = JSON.parse(fs.readFileSync(logFile)); } catch {}
  const entry = { time: new Date().toISOString(), side, token, amount, price };
  if (reason) entry.reason = reason;
  if (typeof pnlPct === 'number') entry.pnlPct = Number(pnlPct.toFixed(2));
  trades.push(entry);
  fs.writeFileSync(logFile, JSON.stringify(trades, null, 2));
}

async function loop() {
  const prices = await getPrices();
  if (!prices) return;

  for (const symbol of config.TOKENS) {
    const price = prices[symbol.toLowerCase()];
    if (!price) continue;
    console.log(`\u23f1 Checking ${symbol} at $${price}`);

    if (!history[symbol]) history[symbol] = [];
    history[symbol].push(price);
    if (history[symbol].length > 100) history[symbol].shift();

    const closing = history[symbol];
    if (closing.length < 14) {
      console.log(`\u23f8 Waiting for more ${symbol} data (${closing.length}/14)`);
      continue;
    }

    if (!activeTrades[symbol]) {
      if (strategy.shouldBuy(symbol, closing)) {
        console.log(`\ud83d\udfe2 Signal: BUY ${symbol}`);
        if (paper) {
          console.log(`\ud83e\uddea PAPER TRADE: Simulated BUY ${symbol} at $${price}`);
        } else {
          await trade.buy(0.01, [], symbol); // placeholder path
        }
        risk.updateEntry(symbol, price);
        activeTrades[symbol] = true;
        logTrade('BUY', symbol, 0.01, price, 'signal');
      }
    } else {
      const hitStop = risk.stopLoss(symbol, price);
      const hitProfit = risk.takeProfit(symbol, price);
      const sellSignal = strategy.shouldSell(symbol, closing);
      if (hitStop || hitProfit || sellSignal) {
        const reason = sellSignal ? 'signal' : hitStop ? 'stopLoss' : 'takeProfit';
        const entry = risk.getEntry(symbol) || price;
        const pnl = ((price - entry) / entry) * 100;
        if (paper) {
          console.log(`\ud83e\uddea PAPER TRADE: Simulated SELL ${symbol} at $${price}`);
        } else {
          await trade.sell(0.01, [], symbol); // placeholder path
        }
        console.log(`\ud83d\udd34 SELL ${symbol} triggered by ${reason} at $${price} (${pnl.toFixed(2)}%)`);
        logTrade('SELL', symbol, 0.01, price, reason, pnl);
        activeTrades[symbol] = false;
      }
    }
  }
}

function main() {
  console.log("\ud83d\ude80 Bot started.");
  setInterval(loop, 60 * 1000);
}

main();
