require('dotenv').config();
const { getPrices } = require('./datafeeds');
const strategy = require('./strategy');
const trade = require('./trade');
const risk = require('./risk');
const fs = require('fs');
const path = require('path');
const { ethers, getAddress } = require('ethers');
const config = require('./config');
const TOKENS = require('./tokens');
const { getValidTokens, getTop25TradableTokens } = require('./top25');

const MIN_TRADE_USD = 10;
console.debug = () => {};

function localTime() {
  return new Date().toLocaleTimeString('en-US', {
    timeZone: 'America/Los_Angeles',
    hour12: true,
    hour: '2-digit',
    minute: '2-digit',
    timeZoneName: 'short'
  });
}

const routerAbi = [
  'function swapExactETHForTokens(uint amountOutMin, address[] calldata path, address to, uint deadline) payable returns (uint[] memory amounts)',
  'function swapExactTokensForETH(uint amountIn, uint amountOutMin, address[] calldata path, address to, uint deadline) returns (uint[] memory amounts)',
  'function getAmountsOut(uint amountIn, address[] memory path) view returns (uint[] memory amounts)'
];

// Connect to Arbitrum
const provider = new ethers.JsonRpcProvider('https://arb1.arbitrum.io/rpc');
const wallet = new ethers.Wallet(process.env.PRIVATE_KEY, provider);
const walletAddress = getAddress(wallet.address);

let validTokens = [];
const activePositions = new Set();
const lastScores = {};

async function refreshTokenList(initial = false) {
  const tokens = await getTop25TradableTokens();
  if (!tokens || !tokens.length) return;

  if (initial || !validTokens.length) {
    validTokens = tokens.slice(0, 25);
    config.coins = ['WETH', ...validTokens];
    console.log(`[${localTime()}] [TOKENS] Loaded ${validTokens.length} tradable tokens`);
    return;
  }

  const candidates = tokens.filter(t => !validTokens.includes(t));
  const sortable = validTokens.filter(t => !activePositions.has(t));
  sortable.sort((a, b) => (lastScores[a] || 0) - (lastScores[b] || 0));

  const replaceCount = Math.min(10, candidates.length, sortable.length);
  const toRemove = sortable.slice(0, replaceCount);
  const toAdd = candidates.slice(0, replaceCount);

  validTokens = validTokens.filter(t => !toRemove.includes(t));
  validTokens.push(...toAdd);

  const prices = await getPrices();
  for (const symbol of toAdd) {
    const price = prices[symbol.toLowerCase()];
    if (price) {
      if (!history[symbol]) history[symbol] = [];
      history[symbol].push(price, price);
      history[symbol] = history[symbol].slice(-2);
    }
  }

  config.coins = ['WETH', ...validTokens];
  console.log(`[${localTime()}] [TOKENS] Replaced ${toRemove.length} tokens`);
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
  getAddress('0x5c69bee701ef814a2b6a3edd4b1652cb9cc5aa6f'),
  routerAbi,
  wallet
); // placeholder address

const WETH = TOKENS.WETH;

const history = {};
let paper = process.env.PAPER === 'true';
const DRY_RUN = process.env.DRY_RUN === 'true';
let activeTrades = {};
const failureCounts = {};
const disabledTokens = new Set();

let fullScanCount = 0;
let startWeth = 0;
let lastWethBal = 0;

const logFile = path.join(__dirname, '..', 'data', 'trade-log.json');
const tradeLogTxt = path.join(__dirname, '..', 'logs', 'trade-log.txt');
const crashFile = path.join(__dirname, '..', 'logs', 'error-log.txt');

function logError(err) {
  try { fs.mkdirSync(path.dirname(crashFile), { recursive: true }); } catch {}
  const ts = localTime();
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
  const emoji = '💰';
  let line = `${emoji} [${localTime()}] ${side} ${token} ${amount} @ $${price}`;
  if (reason) line += ` (${reason})`;
  if (typeof pnlPct === 'number') line += ` PnL ${pnlPct.toFixed(2)}%`;
  fs.appendFileSync(tradeLogTxt, line + '\n');
}

const failureTimestamps = {};
function recordFailure(symbol, reason) {
  if (!reason) return;
  const now = Date.now();
  if (failureTimestamps[symbol] && now - failureTimestamps[symbol] > 30 * 60 * 1000) {
    failureCounts[symbol] = 0;
  }
  failureTimestamps[symbol] = now;
  if (/liquidity/i.test(reason) || /TRANSFER_FROM_FAILED/i.test(reason)) {
    failureCounts[symbol] = (failureCounts[symbol] || 0) + 1;
    console.warn(`[FAIL] ${symbol}: ${reason}. Verify pair on Uniswap.`);
    if (failureCounts[symbol] >= 3) {
      disabledTokens.add(symbol);
      console.log(`[DISABLED] ${symbol} due to repeated failures`);
    }
  }
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

function formatUsd(value) {
  return '$' + Number(value).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
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


function renderSummary(list, wethBal = 0, ethPrice = 0) {
  const top = list.slice(0, 5);
  const ts = localTime();
  fullScanCount++;
  const coins = [...new Set([...config.coins, ...activePositions])];
  const pnlUsd = (wethBal - startWeth) * (ethPrice || 0);
  const pnlPct = startWeth ? (pnlUsd / (startWeth * (ethPrice || 0))) * 100 : 0;
  const pnlColored = color(`${formatUsd(pnlUsd)} (${pnlPct.toFixed(2)}%)`, pnlUsd >= 0 ? 'green' : 'red');
  const wethValue = wethBal * (ethPrice || 0);
  process.stdout.write('\x1Bc');
  if (config.prettyLogs) {
    console.log(`[${ts}] [Scan ${fullScanCount}/14] ${color('=== ♦ TOP 5 COINS ===', 'magenta')}  [${coins.length - 1} Tokens] [WETH ${wethBal.toFixed(2)} (${formatUsd(wethValue)}) | PnL: ${pnlColored}]`);
    const rows = top.map(r => {
      const entry = risk.getEntry(r.symbol);
      const pnl = entry ? (((r.price - entry) / entry) * 100).toFixed(2) + '%' : '-';
      return [
        r.symbol,
        `$${r.price.toFixed(2)}`,
        String(r.score),
        pnl,
        r.signals.join(', ') || '-'
      ];
    });
    console.log(formatTable(rows, ['Symbol', 'Price', 'Score', 'PnL', 'Matched Signals']));
  } else {
    console.log(`[${ts}] [Scan ${fullScanCount}/14] TOP 5: ` + top.map(r => `${r.symbol}:${r.score}`).join(' '));
  }
  const others = list.slice(5).map(r => r.symbol).join(', ');
  if (others) {
    console.log(color('Other coins: ' + others, 'gray'));
  }
}


async function evaluate(prices, wethBal, ethPrice) {
  const res = [];
  const coins = [...new Set([...config.coins, ...activePositions])];
  const totalScans = coins.length;
  for (const [index, symbol] of coins.entries()) {
    const ts = localTime();
    // console.log(`[${ts}] [Scan ${index + 1}/${totalScans}] === ♦ TOP 5 COINS (Highest Scores) ===`);
    // console.log(`[${ts}] Scanning ${index + 1}/${totalScans}: ${symbol}`);
    const price = prices[symbol.toLowerCase()];
    if (!price) continue;
    if (!history[symbol]) history[symbol] = [];
    history[symbol].push(price);
    if (history[symbol].length > 100) history[symbol].shift();
    const closing = history[symbol];
    const { score, signals } = strategy.score(closing);
    lastScores[symbol] = score;
    res.push({ symbol, price, score, signals, closing });
  }
  res.sort((a, b) => b.score - a.score);
  groupA = res.slice(0, 5).map(r => r.symbol);
  groupB = res.slice(5).map(r => r.symbol);
  renderSummary(res, wethBal, ethPrice);
  return res;
}

async function checkTrades(entries, ethPrice, isTop) {
  for (const { symbol, price, closing, score, signals } of entries) {
    if (['ETH', 'WETH'].includes(symbol)) {
      continue;
    }

    if (disabledTokens.has(symbol)) {
      continue;
    }

    if (closing.length < 14) {
      continue;
    }

    if (!activeTrades[symbol]) {
      if (strategy.shouldBuy(symbol, closing)) {
        const balance = await trade.getWethBalance();
        if (balance * (ethPrice || 0) < 10) {
          console.log('⚠️ Skipping trade – not enough balance');
          continue;
        }
        const feeData = await withRetry(() => provider.getFeeData());
        const gasPrice = feeData.gasPrice || ethers.parseUnits('0', 'gwei');
        const gasCost = Number(ethers.formatEther(gasPrice * 210000n));
        const available = Math.max(balance - gasCost, 0);

        const amountEth = risk.calculatePositionSize(score, available, ethPrice || 3500);
        if (amountEth <= 0) {
          console.log(`[TRADE] Skipped ${symbol}: trade amount below $${MIN_TRADE_USD}`);
          continue;
        }

        let tokenAddr = TOKENS[symbol.toUpperCase()];
        if (!tokenAddr && TOKENS.getTokenAddress) {
          tokenAddr = await TOKENS.getTokenAddress(symbol);
        }
        if (!tokenAddr) {
          console.log("Token address is null, skipping trade.");
          continue;
        }
        let res;
        if (!paper) {
          try {
            res = await trade.buy(symbol, { simulate: isTop, dryRun: DRY_RUN });
            if (!res.success) recordFailure(symbol, res.reason);
          } catch (err) {
            logError(`Failed to trade ETH \u2192 ${symbol} | ${err.message}`);
            recordFailure(symbol, err.message);
          }
        } else {
          res = await trade.buy(symbol, { simulate: isTop, dryRun: true });
        }
        if (res && res.success) {
          risk.updateEntry(symbol, price);
          activeTrades[symbol] = true;
          activePositions.add(symbol);
          logTrade('BUY', symbol, amountEth, price, 'signal');
        }
      }
    } else {
      const hitStop = risk.stopLoss(symbol, price);
      const hitProfit = risk.takeProfit(symbol, price);
      const sellSignal = strategy.shouldSell(symbol, closing);
      if (hitStop || hitProfit || sellSignal) {
        const reason = sellSignal ? 'signal' : hitStop ? 'stopLoss' : 'takeProfit';
        const entry = risk.getEntry(symbol) || price;
        const pnl = ((price - entry) / entry) * 100;
        let res;
        if (!paper) {
          try {
            let tokenAddr = TOKENS[symbol.toUpperCase()];
            if (!tokenAddr && TOKENS.getTokenAddress) {
              tokenAddr = await TOKENS.getTokenAddress(symbol);
            }
            if (!tokenAddr) {
              console.log("Token address is null, skipping trade.");
            } else {
              res = await trade.sellToken(symbol);
              if (!res.success) recordFailure(symbol, res.reason);
            }
          } catch (err) {
            logError(`Failed to trade ${symbol} \u2192 ETH | ${err.message}`);
            recordFailure(symbol, err.message);
          }
        } else {
          let tokenAddr = TOKENS[symbol.toUpperCase()];
          if (!tokenAddr && TOKENS.getTokenAddress) {
            tokenAddr = await TOKENS.getTokenAddress(symbol);
          }
          if (tokenAddr) {
            res = await trade.sellToken(symbol);
          }
        }
        if (res && res.success) {
          logTrade('SELL', symbol, 0.01, price, reason, pnl);
          activeTrades[symbol] = false;
          activePositions.delete(symbol);
        }
      }
    }
  }
}

async function loop() {
  try {
    const prices = await getPrices();
    if (!prices) return;
    lastWethBal = await trade.getWethBalance();
    if (!startWeth) startWeth = lastWethBal;
    const evaluations = await evaluate(prices, lastWethBal, prices.eth);
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
  console.log(`🚀 Bot started at ${localTime()}.`);
  refreshTokenList(true).catch(logError);
  setInterval(() => {
    refreshTokenList().catch(logError);
  }, 60 * 60 * 1000);
  setInterval(() => {
    loop().catch(logError);
  }, 60 * 1000);
}

try {
  main();
} catch (err) {
  logError(`Startup failure | ${err.stack || err}`);
}

