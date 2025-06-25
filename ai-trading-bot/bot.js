require('dotenv').config();
const FORCE_REFRESH = process.argv.includes('--force-refresh');
if (FORCE_REFRESH) console.log('🔁 Forced refresh enabled');
const { getPrices } = require('./datafeeds');
const strategy = require('./strategy');
const trade = require('./trade');
const risk = require('./risk');
const fs = require('fs');
const path = require('path');
const { ethers, getAddress } = require('ethers');
const config = require('./config');
const TOKENS = require('./tokens');
const { getValidTokens } = require('./top25');
const DEBUG_TOKENS_FLAG = process.argv.includes('--debug-tokens');
if (DEBUG_TOKENS_FLAG) {
  config.debugTokens = true;
  console.log('🐞 Debug token logging enabled');
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

let validTokens = [];
const activePositions = new Set();
const lastScores = {};

async function refreshTokenList(initial = false, force = false) {
  if (force) console.log('🔁 Forced refresh');
  const list = await getValidTokens(force);
  if (!list || !list.length) return;
  list.sort((a, b) => b.score - a.score);
  const count = config.tokenCount || 50;
  const tokens = list.slice(0, count).map(t => t.symbol);

  if (initial || !validTokens.length) {
    validTokens = tokens.slice(0, count);
    config.coins = ['WETH', ...validTokens];
    console.log(`[${localTime()}] [TOKENS] Loaded ${validTokens.length} tradable tokens`);
    if (config.debugTokens) {
      console.log('Tokens:', validTokens.join(', '));
    }
    console.log('✅ Using new list');
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
  const limit = config.tokenCount || 50;
  validTokens = validTokens.slice(0, limit);

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
  if (config.debugTokens) {
    console.log('Tokens:', validTokens.join(', '));
  }
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
  const coins = [...new Set([...config.coins, ...activePositions])];
  const pnlUsd = (wethBal - startWeth) * (ethPrice || 0);
  const pnlPct = startWeth ? (pnlUsd / (startWeth * (ethPrice || 0))) * 100 : 0;
  const pnlColored = color(`${formatUsd(pnlUsd)} (${pnlPct.toFixed(2)}%)`, pnlUsd >= 0 ? 'green' : 'red');
  const wethValue = wethBal * (ethPrice || 0);
  process.stdout.write('\x1Bc');
  console.log(`[${ts}] [Scan ${fullScanCount}/14] ${color('=== ♦ TOP 5 COINS ===', 'magenta')}  [${coins.length - 1} Tokens] [WETH ${wethBal.toFixed(2)} (${formatUsd(wethValue)}) | PnL: ${pnlColored}]`);

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

async function runTokenTests() {
  const cache = path.join(__dirname, '..', 'data', 'tokens.json');
  let tokens;
  try {
    tokens = JSON.parse(fs.readFileSync(cache));
  } catch {
    console.log('⚠️ No cached tokens to validate');
    return;
  }
  let success = 0;
  const failures = [];
  for (const t of tokens) {
    let addr;
    try {
      addr = getAddress(t.address);
    } catch {
      failures.push(`${t.symbol} failed (invalid address)`);
      continue;
    }
    const liq = await trade.validateLiquidity(TOKENS.WETH, addr, t.symbol);
    if (!liq) {
      failures.push(`${t.symbol} failed (no liquidity)`);
      continue;
    }
    const price = await trade.getTokenUsdPrice(t.symbol);
    if (!price) {
      failures.push(`${t.symbol} failed (price fetch failed)`);
      continue;
    }
    success++;
  }
  console.log(`✅ ${success}/${tokens.length} tokens validated successfully.`);
  failures.forEach(f => console.log(`❌ ${f}`));
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
    if (!price) {
      console.log(`⚠️ No price data for ${symbol}`);
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
      console.log(`Skipping ${symbol}: score = 0`);
    }
    if (config.debugTokens) {
      console.log(`💡 TOKEN LOOP: ${symbol}, score: ${score}`);
    }
    res.push({ symbol, price, score, signals, closing });
  }
  res.sort((a, b) => b.score - a.score);
  groupA = res.slice(0, 5).map(r => r.symbol);
  groupB = res.slice(5).map(r => r.symbol);
  return res;
}

async function checkTrades(entries, ethPrice, isTop) {
  for (const { symbol, price, closing, score, signals } of entries) {
    if (['ETH', 'WETH'].includes(symbol)) {
      continue;
    }

    if (disabledTokens.has(symbol)) {
      if (config.debugTokens) console.log(`⚠️ ${symbol} disabled`);
      continue;
    }

  if (closing.length < 5) {
    if (config.debugTokens) console.log(`❌ Insufficient candles for ${symbol}`);
    continue;
  }

    if (score < (config.signalThreshold || 2) && !process.env.AGGRESSIVE) {
      console.log(`Skipping ${symbol}: score = ${score}`);
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
            if (!tokenAddr && TOKENS.getTokenAddress) {
              tokenAddr = await TOKENS.getTokenAddress(symbol);
            }
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
          if (!tokenAddr && TOKENS.getTokenAddress) {
            tokenAddr = await TOKENS.getTokenAddress(symbol);
          }
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
    const evaluations = await evaluate(prices, lastWethBal, prices.eth);
    const ethPrice = prices.eth;
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
  await TOKENS.load();
  await refreshTokenList(true, FORCE_REFRESH).catch(logError);
  await runTokenTests();
  setInterval(() => {
    refreshTokenList().catch(logError);
  }, 60 * 60 * 1000);
  setInterval(() => {
    loop().catch(logError);
  }, 60 * 1000);
}

main().catch(err => {
  logError(`Startup failure | ${err.stack || err}`);
});

