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
const errorFile = path.join(__dirname, '..', 'logs', 'error.log');

function logError(message) {
  try { fs.mkdirSync(path.dirname(errorFile), { recursive: true }); } catch {}
  const ts = new Date().toISOString().slice(0, 16).replace('T', ' ');
  fs.appendFileSync(errorFile, `[${ts}] ERROR: ${message}\n`);
}

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
  try {
    const prices = await getPrices();
    if (!prices) return;

    for (const symbol of config.coins) {
      if (['ETH', 'WETH'].includes(symbol)) {
        console.log('\u26a0\ufe0f Skipping ETH to ETH trade');
        continue;
      }

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
          const balance = await trade.getEthBalance();
          const amountEth = balance * 0.05;
          if (paper) {
            console.log(`\ud83e\uddea PAPER TRADE: Simulated BUY ${symbol} at $${price}`);
          } else {
            try {
              await trade.buy(amountEth, [], symbol); // placeholder path
            } catch (err) {
              logError(`Failed to trade ETH \u2192 ${symbol} | Reason: ${err.message}`);
              await new Promise(res => setTimeout(res, 30000));
              try { await trade.buy(amountEth, [], symbol); } catch (err2) {
                logError(`Retry failed ETH \u2192 ${symbol} | Reason: ${err2.message}`);
              }
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
              await trade.sell(0.01, [], symbol); // placeholder path
            } catch (err) {
              logError(`Failed to trade ${symbol} \u2192 ETH | Reason: ${err.message}`);
              await new Promise(res => setTimeout(res, 30000));
              try { await trade.sell(0.01, [], symbol); } catch (err2) {
                logError(`Retry failed ${symbol} \u2192 ETH | Reason: ${err2.message}`);
              }
            }
          }
          console.log(`\ud83d\udd34 SELL ${symbol} triggered by ${reason} at $${price} (${pnl.toFixed(2)}%)`);
          logTrade('SELL', symbol, 0.01, price, reason, pnl);
          activeTrades[symbol] = false;
        }
      }
    }
  }
  } catch (err) {
    logError(`Loop failure | Reason: ${err.message}`);
  }
}

function main() {
  console.log("\ud83d\ude80 Bot started.");
  setInterval(loop, 60 * 1000);
}

main();
