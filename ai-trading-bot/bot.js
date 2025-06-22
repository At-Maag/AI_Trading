require('dotenv').config();
const { getPrices } = require('./datafeeds');
const strategy = require('./strategy');
const trade = require('./trade');
const risk = require('./risk');
const fs = require('fs');
const path = require('path');
const { ethers } = require('ethers');
const config = require('./config');

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
const router = new ethers.Contract(
  ethers.utils.getAddress('0x5c69bee701ef814a2b6a3edd4b1652cb9cc5aa6f'),
  routerAbi,
  wallet
); // placeholder address

const WETH = ethers.utils.getAddress('0xC02aaA39b223fe8d0a0e5c4f27ead9083c756cc2');

const TOKEN_ADDRESSES = {
  LINK: ethers.utils.getAddress('0x514910771af9ca656af840dff83e8264ecf986ca'),
  UNI: ethers.utils.getAddress('0x1f9840a85d5af5bf1d1762f925bdaddc4201f984'),
  ARB: ethers.utils.getAddress('0x912ce59144191c1204e64559fe8253a0e49e6548'),
  MATIC: ethers.utils.getAddress('0x7d1afa7b718fb893db30a3abc0cfc608aacfebb0'),
  WBTC: ethers.utils.getAddress('0x2260fac5e5542a773aa44fbcfedf7c193bc2c599'),
  AAVE: ethers.utils.getAddress('0x7fc66500c84a76ad7e9c93437bfc5ac33e2ddae9'),
  COMP: ethers.utils.getAddress('0xc00e94cb662c3520282e6f5717214004a7f26888'),
  SNX: ethers.utils.getAddress('0xc011a72400e58ecd99ee497cf89e3775d4bd732f'),
  SUSHI: ethers.utils.getAddress('0x6b3595068778dd592e39a122f4f5a5cf09c90fe2'),
  LDO: ethers.utils.getAddress('0x5a98fcbea52bddc8ab185592a42f5edb2fa461ff'),
  MKR: ethers.utils.getAddress('0x9f8f72aa9304c8b593d555f12ef6589cc3a579a2'),
  CRV: ethers.utils.getAddress('0xd533a949740bb3306d119cc777fa900ba034cd52'),
  GRT: ethers.utils.getAddress('0xc944e90c64b2c07662a292be6244bdf05cda44a7'),
  ENS: ethers.utils.getAddress('0xc18360217d8f7ab5e5edd226be63ede2a818f5e9'),
  '1INCH': ethers.utils.getAddress('0x111111111117dc0aa78b770fa6a738034120c302'),
  DYDX: ethers.utils.getAddress('0x92d6c1e31e14520e676a687f0a93788b716beff5'),
  BAL: ethers.utils.getAddress('0xba100000625a3754423978a60c9317c58a424e3d'),
  BNT: ethers.utils.getAddress('0x1f573d6fb3f13d689ff844b4cc5c5fbba64ec70b'),
  REN: ethers.utils.getAddress('0x408e41876cccdc0f92210600ef50372656052a38'),
  OCEAN: ethers.utils.getAddress('0x967da4048cd07ab37855c090aaf366e4ce1b9f48'),
  BAND: ethers.utils.getAddress('0x5ff131c1739bf7f2b63e1e6b6591ead5e0ff9112'),
  RLC: ethers.utils.getAddress('0x607f4c5bb672230e8672085532f7e901544a7375'),
  AMPL: ethers.utils.getAddress('0xd46ba6d942050d489dbd938a2c909a5d5039a161'),
  STORJ: ethers.utils.getAddress('0xb64e280e9d1b5dbefaeeb9b253f4f2e405fdbe71')
};

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
        const feeData = await provider.getFeeData();
        const gasPrice = feeData.gasPrice || ethers.parseUnits('0', 'gwei');
        const gasCost = Number(ethers.formatEther(gasPrice * 210000n));
        const available = Math.max(balance - gasCost, 0);

        const amountEth = risk.calculatePositionSize(score, available, ethPrice || 3500);
        if (amountEth <= 0) {
          console.log(`[SKIP] Trade amount below $${MIN_TRADE_USD} for ${symbol}`);
          continue;
        }

        const tokenAddr = TOKEN_ADDRESSES[symbol];
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
            const tokenAddr = TOKEN_ADDRESSES[symbol];
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
  setInterval(() => {
    loop().catch(logError);
  }, 60 * 1000);
}

main();

