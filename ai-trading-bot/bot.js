require('dotenv').config();
const { getPrices } = require('./datafeeds');
const strategy = require('./strategy');
const trade = require('./trade');
const risk = require('./risk');
const fs = require('fs');
const path = require('path');
const config = require('./config');

const history = {};
let paper = process.env.PAPER === 'true';
let activeTrades = {};

const logFile = path.join(__dirname, '..', 'data', 'trade-log.json');
const errorFile = path.join(__dirname, '..', 'logs', 'error.log');

function logError(err) {
  try { fs.mkdirSync(path.dirname(errorFile), { recursive: true }); } catch {}
  const ts = new Date().toISOString();
  const msg = err instanceof Error ? err.stack || err.message : err;
  fs.appendFileSync(errorFile, `[${ts}] ${msg}\n`);
  console.error(msg);
}

process.on('unhandledRejection', logError);
process.on('uncaughtException', logError);

function logTrade(side, token, amount, price, reason, pnlPct) {
  let trades = [];
  try { trades = JSON.parse(fs.readFileSync(logFile)); } catch {}
  const entry = { time: new Date().toISOString(), side, token, amount, price };
  if (reason) entry.reason = reason;
  if (typeof pnlPct === 'number') entry.pnlPct = Number(pnlPct.toFixed(2));
  trades.push(entry);
  fs.writeFileSync(logFile, JSON.stringify(trades, null, 2));
}

let lastGroupBCheck = 0;
let groupA = [];
let groupB = [];

function logStatus(group, { symbol, price, score, signals }) {
  const ts = new Date().toISOString().replace('T', ' ').slice(0, 19);
  console.log(`[${ts}] [${group}] ${symbol} $${price} | score ${score} | ${signals.join(', ')}`);
}

async function evaluate(prices) {
  const res = [];
  for (const symbol of config.coins) {
    const price = prices[symbol.toLowerCase()];
    if (!price) continue;
    if (!history[symbol]) history[symbol] = [];
    history[symbol].push(price);
    if (history[symbol].length > 100) history[symbol].shift();
    const closing = history[symbol];
    const { score, signals } = strategy.score(closing);
    res.push({ symbol, price, score, signals, closing });
  }
  res.sort((a, b) => b.score - a.score);
  groupA = res.slice(0, 5).map(r => r.symbol);
  groupB = res.slice(5).map(r => r.symbol);
  res.forEach(r => logStatus(groupA.includes(r.symbol) ? 'A' : 'B', r));
  return res;
}

async function checkTrades(entries) {
  for (const { symbol, price, closing } of entries) {
    if (['ETH', 'WETH'].includes(symbol)) {
      console.log('\u26a0\ufe0f Skipping ETH to ETH trade');
      continue;
    }

    if (closing.length < 14) {
      console.log(`\u23f8 Waiting for more ${symbol} data (${closing.length}/14)`);
      continue;
    }

    if (!activeTrades[symbol]) {
      if (strategy.shouldBuy(symbol, closing)) {
        console.log(`\ud83d\udfe2 Signal: BUY ${symbol}`);
        const balance = await trade.getEthBalance();
        const amountEth = balance * 0.05;
        if (paper) {
          console.log(`\ud83e\uddea PAPER TRADE: Simulated BUY ${symbol} at $${price}`);
        } else {
          try {
            await trade.buy(amountEth, [], symbol);
          } catch (err) {
            logError(`Failed to trade ETH \u2192 ${symbol} | ${err.message}`);
          }
        }
        risk.updateEntry(symbol, price);
        activeTrades[symbol] = true;
        logTrade('BUY', symbol, amountEth, price, 'signal');
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
          try {
            await trade.sell(0.01, [], symbol);
          } catch (err) {
            logError(`Failed to trade ${symbol} \u2192 ETH | ${err.message}`);
          }
        }
        console.log(`\ud83d\udd34 SELL ${symbol} triggered by ${reason} at $${price} (${pnl.toFixed(2)}%)`);
        logTrade('SELL', symbol, 0.01, price, reason, pnl);
        activeTrades[symbol] = false;
      }
    }
  }
}

async function loop() {
  try {
    const prices = await getPrices();
    if (!prices) return;
    const evaluations = await evaluate(prices);
    await checkTrades(evaluations.filter(e => groupA.includes(e.symbol)));
    const now = Date.now();
    if (now - lastGroupBCheck >= 5 * 60 * 1000) {
      await checkTrades(evaluations.filter(e => groupB.includes(e.symbol)));
      lastGroupBCheck = now;
    }
  } catch (err) {
    logError(`Loop failure | ${err.stack || err}`);
  }
}

function main() {
  console.log('\ud83d\ude80 Bot started.');
  setInterval(() => {
    loop().catch(logError);
  }, 60 * 1000);
}

main();

