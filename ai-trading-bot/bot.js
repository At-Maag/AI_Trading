require('dotenv').config();
const { getPrices } = require('./datafeeds');
const strategy = require('./strategy');
const trade = require('./trade');
const risk = require('./risk');
const fs = require('fs');
const path = require('path');
const { ethers } = require('ethers');
const config = require('./config');
const TOKENS = require('./tokens');
const { getValidTokens } = require('./dynamicTokens');

const MIN_TRADE_USD = 10;
console.debug = () => {};

const routerAbi = [
  'function swapExactETHForTokens(uint amountOutMin, address[] calldata path, address to, uint deadline) payable returns (uint[] memory amounts)',
  'function swapExactTokensForETH(uint amountIn, uint amountOutMin, address[] calldata path, address to, uint deadline) returns (uint[] memory amounts)',
  'function getAmountsOut(uint amountIn, address[] memory path) view returns (uint[] memory amounts)'
];

const provider = new ethers.InfuraProvider('mainnet', process.env.INFURA_API_KEY);
const wallet = new ethers.Wallet(process.env.PRIVATE_KEY, provider);
const walletAddress = ethers.utils.getAddress(wallet.address);

let validTokens = [];

async function refreshTokenList() {
  const tokens = await getValidTokens();
  if (tokens && tokens.length) {
    validTokens = tokens;
    config.coins = ['ETH', 'WETH', ...validTokens];
    console.log(`[TOKENS] Loaded ${validTokens.length} tradable tokens`);
  }
}

async function withRetry(fn, retries = 3, delay = 1000) {
  for (let i = 0; i < retries; i++) {
    try {
      return await fn();
    } catch (err) {
      if (i < retries - 1) {
        const d = delay * 2 ** i;
        console.warn(`[RETRY] ${err.message || err}. Waiting ${d}ms`);
        await new Promise(res => setTimeout(res, d));
      } else {
        throw err;
      }
    }
  }
}
const router = new ethers.Contract(
  ethers.utils.getAddress('0x5c69bee701ef814a2b6a3edd4b1652cb9cc5aa6f'),
  routerAbi,
  wallet
); // placeholder address

const WETH = TOKENS.WETH;

const history = {};
let paper = process.env.PAPER === 'true';
let activeTrades = {};

let fullScanCount = 0;

const logFile = path.join(__dirname, '..', 'data', 'trade-log.json');
const tradeLogTxt = path.join(__dirname, '..', 'logs', 'trade-log.txt');
const crashFile = path.join(__dirname, '..', 'logs', 'error-log.txt');

function logError(err) {
  try { fs.mkdirSync(path.dirname(crashFile), { recursive: true }); } catch {}
  const ts = new Date().toISOString();
  const msg = err instanceof Error ? err.stack || err.message : err;
  fs.appendFileSync(crashFile, `[${ts}] ${msg}\n`);
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

  try { fs.mkdirSync(path.dirname(tradeLogTxt), { recursive: true }); } catch {}
  let line = `[${entry.time}] ${side} ${token} ${amount} @ $${price}`;
  if (reason) line += ` (${reason})`;
  if (typeof pnlPct === 'number') line += ` PnL ${pnlPct.toFixed(2)}%`;
  fs.appendFileSync(tradeLogTxt, line + '\n');
}

let lastGroupBCheck = 0;
let groupA = [];
let groupB = [];

const COLORS = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  magenta: '\x1b[35m',
  gray: '\x1b[90m'
};

function color(text, c) {
  return COLORS[c] + text + COLORS.reset;
}

function formatTable(rows, headers = []) {
  const widths = headers.map((h, i) => Math.max(h.length, ...rows.map(r => r[i].length)));
  const line = (left, fill, mid, right) => left + widths.map(w => fill.repeat(w + 2)).join(mid) + right;
  let out = [line('┌', '─', '┬', '┐')];
  if (headers.length) {
    out.push('│ ' + headers.map((h, i) => h.padEnd(widths[i])).join(' │ ') + ' │');
    out.push(line('├', '─', '┼', '┤'));
  }
  rows.forEach(r => {
    out.push('│ ' + r.map((c, i) => c.padEnd(widths[i])).join(' │ ') + ' │');
  });
  out.push(line('└', '─', '┴', '┘'));
  return out.join('\n');
}


function renderSummary(list) {
  const top = list.slice(0, 5);
  const ts = new Date().toISOString().replace('T', ' ').slice(0, 19);
  fullScanCount++;
  if (config.prettyLogs) {
    console.log(`[${ts}] [Scan ${fullScanCount}/14] ${color('=== 🏆 TOP 5 COINS (Highest Scores) ===', 'magenta')}`);
    const rows = top.map(r => [
      r.symbol,
      `$${r.price.toFixed(2)}`,
      String(r.score),
      r.signals.join(', ') || '-'
    ]);
    console.log(formatTable(rows, ['Symbol', 'Price', 'Score', 'Matched Signals']));
  } else {
    console.log(`[${ts}] [Scan ${fullScanCount}/14] TOP 5: ` + top.map(r => `${r.symbol}:${r.score}`).join(' '));
  }
  const others = list.slice(5).map(r => r.symbol).join(', ');
  if (others) {
    console.log(color('Other coins: ' + others, 'gray'));
  }
}


async function evaluate(prices) {
  const res = [];
  const totalScans = config.coins.length;
  for (const [index, symbol] of config.coins.entries()) {
    const ts = new Date().toISOString().replace('T', ' ').slice(0, 19);
    // console.log(`[${ts}] [Scan ${index + 1}/${totalScans}] === ♦ TOP 5 COINS (Highest Scores) ===`);
    // console.log(`[${ts}] Scanning ${index + 1}/${totalScans}: ${symbol}`);
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
  renderSummary(res);
  return res;
}

async function checkTrades(entries, ethPrice, isTop) {
  for (const { symbol, price, closing, score, signals } of entries) {
    if (['ETH', 'WETH'].includes(symbol)) {
      continue;
    }

    if (closing.length < 14) {
      continue;
    }

    if (!activeTrades[symbol]) {
      if (strategy.shouldBuy(symbol, closing)) {
        const balance = await trade.getEthBalance();
        const feeData = await withRetry(() => provider.getFeeData());
        const gasPrice = feeData.gasPrice || ethers.parseUnits('0', 'gwei');
        const gasCost = Number(ethers.formatEther(gasPrice * 210000n));
        const available = Math.max(balance - gasCost, 0);

        const amountEth = risk.calculatePositionSize(score, available, ethPrice || 3500);
        if (amountEth <= 0) {
          console.log(`[SKIP] Trade amount below $${MIN_TRADE_USD} for ${symbol}`);
          continue;
        }

        const tokenAddr = TOKENS[symbol.toUpperCase()];
        if (!tokenAddr) {
          console.log("Token address is null, skipping trade.");
          continue;
        }
        if (!paper) {
          try {
            await trade.buy(amountEth, [WETH, tokenAddr], symbol, { simulate: isTop });
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
        if (!paper) {
          try {
            const tokenAddr = TOKENS[symbol.toUpperCase()];
            if (!tokenAddr) {
              console.log("Token address is null, skipping trade.");
            } else {
              await trade.sell(0.01, [tokenAddr, WETH], symbol, { simulate: isTop });
            }
          } catch (err) {
            logError(`Failed to trade ${symbol} \u2192 ETH | ${err.message}`);
          }
        }
        logTrade('SELL', symbol, 0.01, price, reason, pnl);
        activeTrades[symbol] = false;
      }
    }
  }
}

async function loop() {
  try {
    console.clear();
    const prices = await getPrices();
    if (!prices) return;
    const evaluations = await evaluate(prices);
    const ethPrice = prices.eth;
    await checkTrades(evaluations.filter(e => groupA.includes(e.symbol)), ethPrice, true);
    const now = Date.now();
    if (now - lastGroupBCheck >= 5 * 60 * 1000) {
      await checkTrades(evaluations.filter(e => groupB.includes(e.symbol)), ethPrice, false);
      lastGroupBCheck = now;
    }
  } catch (err) {
    logError(`Loop failure | ${err.stack || err}`);
  }
}

function main() {
  console.log('\ud83d\ude80 Bot started.');
  refreshTokenList().catch(logError);
  setInterval(() => {
    refreshTokenList().catch(logError);
  }, 12 * 60 * 60 * 1000);
  setInterval(() => {
    loop().catch(logError);
  }, 60 * 1000);
}

try {
  main();
} catch (err) {
  logError(`Startup failure | ${err.stack || err}`);
}

