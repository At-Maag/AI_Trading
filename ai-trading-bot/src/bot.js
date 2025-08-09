require('dotenv').config();
const { logError } = require('./logger');
process.on('unhandledRejection', (e) => logError(e, { title: 'Unhandled Rejection' }));
process.on('uncaughtException', (e) => logError(e, { title: 'Uncaught Exception' }));
const FORCE_REFRESH = process.argv.includes('--force-refresh');
if (FORCE_REFRESH) console.log('🔁 Forced refresh enabled');
const strategy = require('./strategy');
const trade = require('./trade');
const { TOKENS } = trade;
const { refreshTokenList, SELL_DESTINATION } = require('./tokenManager');
const risk = require('./risk');
const fs = require('fs');
const path = require('path');
const { ethers, getAddress } = require('ethers');
const DEBUG_TOKENS = process.env.DEBUG_TOKENS === 'true';
const debug_pairs = process.env.DEBUG_PAIRS === 'true';

const tokenListPath = path.join(__dirname, '..', 'data', 'arbitrum.tokenlist.json');
let coins = ['WETH'];
const SIGNAL_THRESHOLD = 2;

function loadTokenList() {
  try {
    const data = JSON.parse(fs.readFileSync(tokenListPath));
    if (!Array.isArray(data.tokens)) return [];
    return data.tokens.filter(t => ethers.isAddress(t.address)).map(t => ({
      symbol: String(t.symbol).toUpperCase(),
      address: t.address
    }));
  } catch {
    return [];
  }
}

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
const provider = new ethers.JsonRpcProvider(process.env.ARB_RPC_URL);
const rawKey = process.env.PRIVATE_KEY ? process.env.PRIVATE_KEY.trim() : '';
const wallet = new ethers.Wallet(rawKey.startsWith('0x') ? rawKey : '0x' + rawKey, provider);
const walletAddress = getAddress(wallet.address);

const activePositions = new Set();
const lastScores = {};
const positionIndex = {};


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
const pnlFile = path.join(__dirname, 'data', 'pnl-log.jsonl');
const mlFile = path.join(__dirname, 'data', 'ml-dataset.jsonl');


function restorePortfolio() {
  let trades = [];
  try { trades = JSON.parse(fs.readFileSync(logFile)); } catch { return; }
  const temp = {};
  for (const t of trades) {
    const sym = (t.token || '').toUpperCase();
    if (!sym || ['WETH', 'USDC'].includes(sym)) continue;
    const qty = Number(t.qty || t.amount || 0);
    const price = Number(t.price || 0);
    if (!temp[sym]) temp[sym] = { qty: 0, cost: 0 };
    if (t.action === 'BUY' || t.side === 'BUY') {
      temp[sym].qty += qty;
      temp[sym].cost += qty * price;
    } else if (t.action === 'SELL' || t.side === 'SELL') {
      const avg = temp[sym].qty ? temp[sym].cost / temp[sym].qty : price;
      temp[sym].qty -= qty;
      temp[sym].cost -= avg * qty;
    }
  }
  const held = {};
  for (const sym of Object.keys(temp)) {
    if (temp[sym].qty > 0) {
      const avg = temp[sym].cost / temp[sym].qty;
      positionIndex[sym] = { qty: temp[sym].qty, avgPrice: avg };
      activePositions.add(sym);
      activeTrades[sym] = true;
      risk.updateEntry(sym, avg);
      held[sym] = TOKENS[sym];
    }
  }
  return held;
}

function logTrade(action, token, qty, price, reason, pnlPct, dest, txHash) {
  let trades = [];
  try { trades = JSON.parse(fs.readFileSync(logFile)); } catch {}
  const timestamp = new Date().toLocaleString('en-US', {
    timeZone: 'America/Los_Angeles'
  });
  const entry = { timestamp, token, qty: Number(qty), price, action };
  if (reason) entry.reason = reason;
  if (typeof pnlPct === 'number') entry.pnlPct = Number(pnlPct.toFixed(2));
  if (dest) entry.to = dest;
  if (txHash) entry.txHash = txHash;
  if (qty && price && action === 'SELL') {
    entry.value = Number((qty * price).toFixed(2));
  }
  trades.push(entry);
  fs.writeFileSync(logFile, JSON.stringify(trades, null, 2));

  const emoji = '💰';
  let line = `${emoji} [${localTime()}] ${action} ${token} ${qty} @ $${price}`;
  if (reason) line += ` (${reason})`;
  if (typeof pnlPct === 'number') line += ` PnL ${pnlPct.toFixed(2)}%`;
  if (dest) line += ` -> ${dest}`;
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
  const symbols = new Set();
  for (const s of activePositions) {
    if (!['WETH', 'USDC'].includes(s)) symbols.add(s);
  }
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
    const pnlStr =
      h.pnlPct === null ?
        '-' :
        `${h.pnlPct >= 0 ? '+' : ''}${h.pnlPct.toFixed(1)}% (${formatUsd(h.pnlUsd)})`;
    const colored =
      h.pnlPct === null ?
        pnlStr :
        color(pnlStr, h.pnlPct >= 0 ? 'green' : 'red');

    const valueUsd = h.price && h.qty ? h.price * h.qty : null;

    return [
      String(idx + 1),
      h.symbol,
      valueUsd !== null ? formatUsd(valueUsd) : '-',
      h.qty.toFixed(2),
      colored
    ];
  });
  console.log(formatTable(rows, ['#', 'Symbol', 'Value (USD)', 'Qty', 'PnL']));

  const posLine = rows.map(r => `${r[1]}:${r[3]}`).join(' | ');
  console.log(`Position Index -> ${posLine}`);
}

function recordPnl(prices, holdings, wethBal) {
  const totalValue = holdings.reduce((s, h) => s + (h.price * h.qty || 0), 0) +
    wethBal * (prices.eth || 0);
  const unreal = holdings.reduce((s, h) => s + (h.pnlUsd || 0), 0);
  const entry = {
    timestamp: new Date().toLocaleString('en-US', { timeZone: 'America/Los_Angeles' }),
    totalValue: Number(totalValue.toFixed(2)),
    unrealizedPnL: Number(unreal.toFixed(2)),
    numPositions: holdings.length
  };
  try {
    fs.appendFileSync(pnlFile, JSON.stringify(entry) + '\n');
  } catch {}
}

async function getPrices() {
  const prices = {};
  let successCount = 0;
  const ethPrice = await trade.getEthPrice();
  prices.eth = ethPrice;
  for (const symbol of coins) {
    if (['ETH', 'WETH'].includes(symbol)) {
      prices[symbol.toLowerCase()] = ethPrice;
      if (ethPrice) successCount++;
      if (debug_pairs && ethPrice) {
        console.log(`[✓] ${symbol} = $${ethPrice.toFixed(2)}`);
      }
      continue;
    }
    const p = await trade.getTokenUsdPrice(symbol);
    if (p) {
      prices[symbol.toLowerCase()] = p;
      if (p > 0) {
        successCount++;
        if (debug_pairs) console.log(`[✓] ${symbol} = $${p.toFixed(2)}`);
      }
    }
  }
  console.log(`✅ ${successCount}/${coins.length} tokens priced`);
  return prices;
}

async function evaluate(prices, wethBal, ethPrice) {
  const res = [];
  const allCoins = [...new Set([...coins, ...activePositions])];
  const totalScans = allCoins.length;
  for (const [index, symbol] of allCoins.entries()) {
    const ts = localTime();
    // console.log(`[${ts}] [Scan ${index + 1}/${totalScans}] === ♦ TOP 5 COINS (Highest Scores) ===`);
    // console.log(`[${ts}] Scanning ${index + 1}/${totalScans}: ${symbol}`);
    const price = prices[symbol.toLowerCase()];
    if (!price) {
      if (debug_pairs) console.log(`⚠️ No price data for ${symbol}`);
      res.push({ symbol, price: 0, score: 0, signals: [], closing: [] });
      continue;
    }
    if (!history[symbol]) history[symbol] = [];
    history[symbol].push(price);
    if (history[symbol].length > 100) history[symbol].shift();
    const closing = history[symbol];
    const { score, signals } = strategy.score(closing);
    lastScores[symbol] = score;
    if (score === 0) {
      if (debug_pairs) {
        console.log(`Skipping ${symbol}: score = 0`);
      }
    }
    if (DEBUG_TOKENS) {
      console.log(`💡 TOKEN LOOP: ${symbol}, score: ${score}`);
    }
    res.push({ symbol, price, score, signals, closing });
  }
  res.sort((a, b) => b.score - a.score);
  const top = res.slice(0, 25);
  groupA = top.slice(0, 5).map(r => r.symbol);
  groupB = top.slice(5).map(r => r.symbol);
  return top;
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

    if (closing.length < 5) {
      if (DEBUG_TOKENS) console.log(`❌ Insufficient candles for ${symbol}`);
      continue;
    }

    if (score < SIGNAL_THRESHOLD && !process.env.AGGRESSIVE) {
      if (debug_pairs) console.log(`Skipping ${symbol}: score = ${score}`);
      continue;
    }

    const signalInfo = strategy.getTradeSignals(closing);
    let decision = 'NONE';
    let hitStop = false;
    let hitProfit = false;
    let sellSignal = false;

    if (!activeTrades[symbol]) {
      if (strategy.shouldBuy(symbol, closing)) {
        decision = 'BUY';
      }
    } else {
      hitStop = risk.stopLoss(symbol, price);
      hitProfit = risk.takeProfit(symbol, price);
      sellSignal = strategy.shouldSell(symbol, closing);
      if (hitStop || hitProfit || sellSignal) {
        decision = 'SELL';
      }
    }

    if (!['WETH', 'USDC'].includes(symbol)) {
      const entry = {
        symbol,
        price,
        rsi: signalInfo.rsi,
        macdHist: signalInfo.macdHist,
        smaAbove: signalInfo.smaAbove,
        momentum: signalInfo.momentum,
        signalScore: signalInfo.signalScore,
        decision,
        timestamp: new Date().toLocaleString('en-US', { timeZone: 'America/Los_Angeles' })
      };
      try { fs.appendFileSync(mlFile, JSON.stringify(entry) + '\n'); } catch {}
    }

    if (!activeTrades[symbol] && decision === 'BUY') {
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
          if (res.qty) {
            if (!positionIndex[symbol]) positionIndex[symbol] = { qty: 0, avgPrice: 0 };
            const prev = positionIndex[symbol];
            const newQty = prev.qty + res.qty;
            const newAvg = ((prev.avgPrice * prev.qty) + res.qty * price) / newQty;
            positionIndex[symbol] = { qty: newQty, avgPrice: newAvg };
          }
        logTrade('BUY', symbol, res.qty || amountEth, price, 'signal', null, null, res.tx);
      }
    } else if (activeTrades[symbol] && decision === 'SELL') {
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
        if (res.qty) {
          const prev = positionIndex[symbol];
          if (prev) {
            const remaining = prev.qty - res.qty;
            if (remaining <= 0) {
              delete positionIndex[symbol];
            } else {
              positionIndex[symbol].qty = remaining;
            }
          }
        }
        logTrade('SELL', symbol, res.qty || 0, price, reason, pnl, SELL_DESTINATION, res.tx && res.tx.hash);
        activeTrades[symbol] = false;
        activePositions.delete(symbol);
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
    const evaluations = await evaluate(prices, lastWethBal, prices.eth);
    const ethPrice = prices.eth;
    renderSummary(evaluations, lastWethBal, ethPrice);
    const holdings = await getHoldings(prices);
    renderHoldings(holdings);
    recordPnl(prices, holdings, lastWethBal);
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

  const held = restorePortfolio();
  await refreshTokenList(held, FORCE_REFRESH);
  trade.refreshLocalTokenList();

  const list = loadTokenList();
  if (list.length) {
    const syms = list.map(t => t.symbol.toUpperCase());
    coins = Array.from(new Set(['WETH', ...syms]));
  } else {
    console.warn('⚠️ Token list empty. Trading WETH only');
  }

  await trade.autoWrapOrUnwrap();
  setInterval(() => {
    loop().catch(logError);
  }, 60 * 1000);

  setInterval(() => {
    const list = loadTokenList();
    if (list.length) {
      const syms = list.map(t => t.symbol.toUpperCase());
      coins = Array.from(new Set(['WETH', ...syms]));
      trade.refreshLocalTokenList();
    }
  }, 60 * 60 * 1000);

  setInterval(async () => {
    const pos = {};
    for (const sym of Object.keys(positionIndex)) {
      pos[sym] = TOKENS[sym];
    }
    await refreshTokenList(pos, false);
    trade.refreshLocalTokenList();
  }, 12 * 60 * 60 * 1000);
}

main().catch(err => {
  logError(`Startup failure | ${err.stack || err}`);
});

