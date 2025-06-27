require('dotenv').config();
const FORCE_REFRESH = process.argv.includes('--force-refresh');
const FORCE_VALIDATE = process.argv.includes('--force-validate');
if (FORCE_REFRESH) console.log('🔁 Forced refresh enabled');
if (FORCE_VALIDATE) console.log('🧹 Force token validation enabled');
const strategy = require('./strategy');
const trade = require('./trade');
const { TOKENS } = trade;
const risk = require('./risk');
const fs = require('fs');
const path = require('path');
const { ethers, getAddress } = require('ethers');
// Import the token validation function from validator.js
const { validateTokens } = require('./validator');
const DEBUG_TOKENS = process.env.DEBUG_TOKENS === 'true';

const tokensPath = path.join(__dirname, 'data', 'tokens.json');
let tokensData = [];
let coins = ['WETH'];
let allTokens = [];
let candidateTokens = [];
let groupA = [];
let groupB = [];
let lastRebalance = 0;
const SIGNAL_THRESHOLD = 2;
try {
  tokensData = JSON.parse(fs.readFileSync(tokensPath));
} catch {}
if (!Array.isArray(tokensData) || tokensData.length === 0) {
  console.error('tokens.json missing or empty. Run "node validator.js" first.');
  process.exit(1);
}
allTokens = tokensData.map(t => t.symbol.toUpperCase());
const feedMap = {};
for (const t of tokensData) {
  if (t.feed) feedMap[t.symbol.toUpperCase()] = t.feed;
}

const MIN_TRADE_USD = 10;
console.debug = () => {};

async function refreshTopTokens() {
  const ethPrice = await trade.getEthPrice();
  const prices = { eth: ethPrice };
  for (const sym of allTokens) {
    if (sym !== 'WETH' && !feedMap[sym]) continue;
    let p = null;
    try {
      p = sym === 'WETH' ? ethPrice : await trade.getTokenUsdPrice(sym);
    } catch {}
    if (p) prices[sym.toLowerCase()] = p;
  }

  const seen = new Set();
  const evaluations = [];
  for (const sym of allTokens) {
    if (seen.has(sym)) continue;
    seen.add(sym);
    const price = prices[sym.toLowerCase()];
    if (!price) continue;
    if (!history[sym]) history[sym] = [];
    history[sym].push(price);
    if (history[sym].length > 100) history[sym].shift();
    const { score } = strategy.score(history[sym]);
    evaluations.push({ symbol: sym, score });
  }
  evaluations.sort((a, b) => b.score - a.score);
  const top = evaluations.slice(0, 25);
  candidateTokens = top.map(e => e.symbol);

  const nonZero = top.filter(t => t.score > 0).slice(0, 5);
  if (nonZero.length >= 5) {
    groupA = nonZero.map(t => t.symbol);
  } else {
    groupA = top.slice(0, 5).map(t => t.symbol);
  }
  if (groupA.length < 5) {
    const extras = allTokens.filter(s => !groupA.includes(s)).slice(0, 5 - groupA.length);
    groupA = groupA.concat(extras);
  }
  // GroupB tracks the top 25 tokens regardless of GroupA membership
  groupB = candidateTokens.slice();

  coins = Array.from(new Set(['WETH', ...candidateTokens]));
  lastRebalance = Date.now();
  const scoresMap = Object.fromEntries(top.map(t => [t.symbol, t.score]));
  const displayA = groupA.map(s => `${s}(${scoresMap[s] ?? 0})`).join(', ');
  console.log(`[REFRESH] GroupA: ${displayA} | GroupB size: ${groupB.length}`);
}

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
const provider = new ethers.JsonRpcProvider(process.env.ARB_RPC_URL);
const rawKey = process.env.PRIVATE_KEY ? process.env.PRIVATE_KEY.trim() : '';
const wallet = new ethers.Wallet(rawKey.startsWith('0x') ? rawKey : '0x' + rawKey, provider);
const walletAddress = getAddress(wallet.address);

const activePositions = new Set();
const lastScores = {};


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

function getWethAddress() {
  return TOKENS.WETH;
}

const history = {};
let paper = process.env.PAPER === 'true';
const DRY_RUN = process.env.DRY_RUN === 'true';
let activeTrades = {};
const failureCounts = {};
const disabledTokens = new Set();

let fullScanCount = 0;
let startWeth = 0;
let lastWethBal = 0;

const logFile = path.join(__dirname, 'data', 'trade-log.json');

function logError(err) {
  console.error(err);
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

  const emoji = '💰';
  let line = `${emoji} [${localTime()}] ${side} ${token} ${amount} @ $${price}`;
  if (reason) line += ` (${reason})`;
  if (typeof pnlPct === 'number') line += ` PnL ${pnlPct.toFixed(2)}%`;
  console.log(line);
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
  setTimeout(() => {
    if (disabledTokens.has(symbol)) {
      disabledTokens.delete(symbol);
      console.log(`[RETRY] Re-enabled ${symbol} after cooldown`);
    }
  }, 12 * 60 * 60 * 1000);
}

let lastGroupBCheck = 0;

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
  const allCoins = [...new Set([...coins, ...activePositions])];
  const pnlUsd = (wethBal - startWeth) * (ethPrice || 0);
  const pnlPct = startWeth ? (pnlUsd / (startWeth * (ethPrice || 0))) * 100 : 0;
  const pnlColored = color(`${formatUsd(pnlUsd)} (${pnlPct.toFixed(2)}%)`, pnlUsd >= 0 ? 'green' : 'red');
  const wethValue = wethBal * (ethPrice || 0);
  process.stdout.write('\x1Bc');
  console.log(`[${ts}] [Scan ${fullScanCount}/14] ${color('=== ♦ TOP 5 COINS ===', 'magenta')}  [${allCoins.length - 1} Tokens] [WETH ${wethBal.toFixed(2)} (${formatUsd(wethValue)}) | PnL: ${pnlColored}]`);

  const rows = top.map((r, idx) => {
    return [
      String(idx + 1),
      r.symbol,
      `$${r.price.toFixed(2)}`,
      String(r.score),
      r.signals && r.signals.length ? r.signals.join(', ') : '-'
    ];
  });

  console.log(formatTable(rows, ['#', 'Symbol', 'Price', 'Score', 'Matched Signals']));
}

async function getHoldings(prices) {
  const symbols = new Set(['WETH', 'USDC', 'USDT', 'DAI']);
  for (const s of activePositions) symbols.add(s);
  const holdings = [];
  for (const sym of symbols) {
    const addr = TOKENS[sym.toUpperCase()];
    if (!addr) continue;
    let bal;
    try {
      bal = await trade.getTokenBalance(addr, walletAddress, sym);
    } catch {
      bal = 0;
    }
    if (!bal || bal <= 0) continue;
    const price = prices[sym.toLowerCase()] || (sym === 'WETH' ? prices.eth : 0);
    const entry = risk.getEntry(sym);
    let pnlPct = null;
    let pnlUsd = null;
    if (entry && price) {
      pnlPct = ((price - entry) / entry) * 100;
      pnlUsd = (pnlPct / 100) * price * bal;
    }
    holdings.push({ symbol: sym, price, qty: bal, pnlPct, pnlUsd });
  }
  return holdings;
}

function renderHoldings(list) {
  console.log(`\n${color('=== 🧾 PORTFOLIO HOLDINGS ===', 'cyan')}`);
  if (!list.length) {
    console.log('📭 No assets held.');
    return;
  }

  const rows = list.map((h, idx) => {
    const pnlStr = h.pnlPct === null ? '-' : `${h.pnlPct >= 0 ? '+' : ''}${h.pnlPct.toFixed(1)}% (${formatUsd(h.pnlUsd)})`;
    const colored = h.pnlPct === null ? pnlStr : color(pnlStr, h.pnlPct >= 0 ? 'green' : 'red');
    return [
      String(idx + 1),
      h.symbol,
      `$${h.price.toFixed(2)}`,
      h.qty.toFixed(2),
      colored
    ];
  });
  console.log(formatTable(rows, ['#', 'Symbol', 'Price', 'Qty', 'PnL']));
}

async function getPrices() {
  const prices = {};
  const ethPrice = await trade.getEthPrice();
  prices.eth = ethPrice;
  for (const symbol of coins) {
    if (['ETH', 'WETH'].includes(symbol)) {
      prices[symbol.toLowerCase()] = ethPrice;
      continue;
    }
    if (!feedMap[symbol]) continue;
    let p = null;
    try {
      p = await trade.getTokenUsdPrice(symbol);
    } catch {}
    if (p) prices[symbol.toLowerCase()] = p;
  }
  return prices;
}

async function evaluate(prices) {
  const res = [];
  const allCoins = [...new Set([...coins, ...activePositions])];
  const totalScans = allCoins.length;
  for (const [index, symbol] of allCoins.entries()) {
    const ts = localTime();
    // console.log(`[${ts}] [Scan ${index + 1}/${totalScans}] === ♦ TOP 5 COINS (Highest Scores) ===`);
    // console.log(`[${ts}] Scanning ${index + 1}/${totalScans}: ${symbol}`);
    const price = prices[symbol.toLowerCase()];
    if (!price) {
      if (DEBUG_TOKENS) console.log(`No price data for ${symbol}`);
      res.push({ symbol, price: 0, score: 0, signals: [], closing: [] });
      continue;
    }
    if (!history[symbol]) history[symbol] = [];
    history[symbol].push(price);
    if (history[symbol].length > 100) history[symbol].shift();
    const closing = history[symbol];
    const { score, signals } = strategy.score(closing);
    lastScores[symbol] = score;
    if (DEBUG_TOKENS) {
      console.log(`💡 TOKEN LOOP: ${symbol}, score: ${score}`);
      if (score === 0) {
        console.log(`Skipping ${symbol}: score = 0`);
      }
    }
    res.push({ symbol, price, score, signals, closing });
  }
  const anyPositive = res.some(r => r.score > 0);
  if (!anyPositive) {
    res.forEach(r => { r.score = 1; });
  }
  res.sort((a, b) => b.score - a.score);
  return res;
}

function rebalanceGroups(evaluations, force = false) {
  const now = Date.now();
  if (!force && now - lastRebalance < 5 * 60 * 1000) return false;
  lastRebalance = now;

  const candSet = new Set(candidateTokens);
  const filtered = evaluations
    .filter(e => candSet.has(e.symbol))
    .sort((a, b) => b.score - a.score);

  candidateTokens = filtered.slice(0, 25).map(e => e.symbol);

  const nonZero = filtered.filter(e => e.score > 0).slice(0, 5);
  let newA = nonZero.length >= 5
    ? nonZero.map(e => e.symbol)
    : filtered.slice(0, 5).map(e => e.symbol);
  if (newA.length < 5) {
    const extras = candidateTokens.filter(s => !newA.includes(s)).slice(0, 5 - newA.length);
    newA = newA.concat(extras);
  }
  // Keep GroupB as the top 25 list for background scanning
  const newB = candidateTokens.slice();

  const changed = JSON.stringify(newA) !== JSON.stringify(groupA);
  groupA = newA;
  groupB = newB;
  coins = Array.from(new Set(['WETH', ...candidateTokens, ...activePositions]));

  if (changed) {
    const scoreMap = Object.fromEntries(filtered.map(e => [e.symbol, e.score]));
    const disp = groupA.map(s => `${s}(${scoreMap[s] ?? 0})`).join(', ');
    console.log(`[PROMOTE] GroupA -> ${disp}`);
  }
  return changed;
}

async function checkTrades(entries, ethPrice, isTop) {
  for (const { symbol, price, closing, score, signals } of entries) {
    if (['ETH', 'WETH'].includes(symbol)) {
      continue;
    }

    if (disabledTokens.has(symbol)) {
      if (DEBUG_TOKENS) console.log(`⚠️ ${symbol} disabled`);
      continue;
    }

  if (closing.length < 10) {
    if (DEBUG_TOKENS) console.log(`❌ Insufficient candles for ${symbol}`);
    continue;
  }

    if (score < SIGNAL_THRESHOLD && !process.env.AGGRESSIVE) {
      if (DEBUG_TOKENS) console.log(`Skipping ${symbol}: score = ${score}`);
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

        const tokenAddr = TOKENS[symbol.toUpperCase()];
        if (!tokenAddr) {
          console.log("Token address is null, skipping trade.");
          continue;
        }
        let res;
        if (!paper) {
          try {
            await trade.autoWrapOrUnwrap();
            res = await trade.buy(symbol, { simulate: isTop, dryRun: DRY_RUN });
            if (!res.success) recordFailure(symbol, res.reason);
          } catch (err) {
            logError(`Failed to trade ETH \u2192 ${symbol} | ${err.message}`);
            recordFailure(symbol, err.message);
          }
        } else {
          await trade.autoWrapOrUnwrap();
          res = await trade.buy(symbol, { simulate: isTop, dryRun: true });
        }
        if (res && res.simulated) {
          console.log(`[DRY RUN] Buy simulated for ${symbol}`);
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
        if (!tokenAddr) {
          console.log("Token address is null, skipping trade.");
        } else {
          await trade.autoWrapOrUnwrap();
          res = await trade.sellToken(symbol);
          if (!res.success) recordFailure(symbol, res.reason);
        }
          } catch (err) {
            logError(`Failed to trade ${symbol} \u2192 ETH | ${err.message}`);
            recordFailure(symbol, err.message);
          }
        } else {
        let tokenAddr = TOKENS[symbol.toUpperCase()];
        if (tokenAddr) {
          await trade.autoWrapOrUnwrap();
          res = await trade.sellToken(symbol);
        }
        }
        if (res && res.simulated) {
          console.log(`[DRY RUN] Sell simulated for ${symbol}`);
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
    await trade.autoWrapOrUnwrap();
    lastWethBal = await trade.getWethBalance();
    if (!startWeth) startWeth = lastWethBal;
    const evaluations = await evaluate(prices);
    const ethPrice = prices.eth;
    rebalanceGroups(evaluations);
    renderSummary(evaluations, lastWethBal, ethPrice);
    const holdings = await getHoldings(prices);
    renderHoldings(holdings);
    await checkTrades(evaluations.filter(e => groupA.includes(e.symbol)), ethPrice, true);
    const now = Date.now();
    if (now - lastGroupBCheck >= 5 * 60 * 1000) {
      await checkTrades(evaluations.filter(e => groupB.includes(e.symbol)), ethPrice, false);
      lastGroupBCheck = now;
    }

    // Summary and portfolio printed above
  } catch (err) {
    logError(`Loop failure | ${err.stack || err}`);
  }
}

async function main() {
  console.log(`🚀 Bot started at ${localTime()}.`);

  // Validate tokens if needed and update coin list
  const validated = await validateTokens(FORCE_VALIDATE);
  if (Array.isArray(validated) && validated.length) {
    const syms = validated.map(t => t.symbol.toUpperCase());
    allTokens = syms;
  }
  if (!allTokens.length) allTokens = tokensData.map(t => t.symbol.toUpperCase());

  await trade.autoWrapOrUnwrap();
  await refreshTopTokens();
  setInterval(refreshTopTokens, 60 * 60 * 1000);
  setInterval(() => {
    loop().catch(logError);
  }, 60 * 1000);
}

main().catch(err => {
  logError(`Startup failure | ${err.stack || err}`);
});

