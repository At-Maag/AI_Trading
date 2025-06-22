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
const router = new ethers.Contract('0x5C69bEe701ef814a2B6a3EDD4B1652CB9cc5aA6f', routerAbi, wallet); // placeholder address

const WETH = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2';

const TOKEN_ADDRESSES = {
  LINK: '0x514910771AF9Ca656af840dff83E8264EcF986CA',
  UNI: '0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984',
  ARB: '0x912CE59144191C1204E64559FE8253a0e49E6548',
  MATIC: '0x7d1afa7b718fb893db30a3abc0cfc608aacfebb0',
  WBTC: '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599',
  AAVE: '0x7Fc66500c84A76Ad7e9c93437bFc5Ac33E2DdAE9',
  COMP: '0xc00e94Cb662C3520282E6f5717214004A7f26888',
  SNX: '0xC011A72400E58ecD99Ee497CF89E3775d4bd732F',
  SUSHI: '0x6B3595068778DD592e39A122f4f5a5cF09C90fE2',
  LDO: '0x5A98FcBEA52BDdC8aB185592A42F5eDb2fA461Ff',
  MKR: '0x9f8F72aA9304c8B593d555F12eF6589cC3A579A2',
  CRV: '0xD533a949740bb3306d119CC777fa900bA034cd52',
  GRT: '0xc944E90C64B2c07662A292be6244BDf05Cda44a7',
  ENS: '0xC18360217D8F7Ab5E5eDd226bE63EDe2a818F5E9',
  '1INCH': '0x111111111117dc0aa78b770fa6a738034120c302',
  DYDX: '0x92D6C1e31e14520e676a687F0a93788B716BEff5',
  BAL: '0xba100000625a3754423978a60c9317c58a424e3D',
  BNT: '0x1f573D6FB3F13d689FF844B4cC5c5fBba64ec70B',
  REN: '0x408e41876cCCDC0F92210600ef50372656052a38',
  OCEAN: '0x967da4048cD07Ab37855c090aAF366e4ce1b9F48',
  BAND: '0x5fF131C1739Bf7f2b63e1e6B6591EAd5e0ff9112',
  RLC: '0x607F4C5BB672230e8672085532f7e901544a7375',
  AMPL: '0xd46ba6d942050d489dbd938a2c909A5d5039A161',
  STORJ: '0xB64E280e9D1B5DbEfaEeB9b253f4F2E405fdBe71'
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

async function checkTrades(entries, ethPrice) {
  const buyMsgs = [];
  const sellMsgs = [];
  for (const { symbol, price, closing, score, signals } of entries) {
    if (['ETH', 'WETH'].includes(symbol)) {
      continue;
    }

    if (closing.length < 14) {
      continue;
    }

    if (!activeTrades[symbol]) {
      if (strategy.shouldBuy(symbol, closing)) {
        const msg = `BUY ${symbol} | Score: ${score} | Price: $${price.toFixed(2)} | ${signals.join(', ')}`;
        buyMsgs.push(color(msg, 'green'));
        const balance = await trade.getEthBalance();
        const feeData = await provider.getFeeData();
        const gasPrice = feeData.gasPrice || ethers.parseUnits('0', 'gwei');
        const gasCost = Number(ethers.formatEther(gasPrice * 210000n));
        const available = Math.max(balance - gasCost, 0);

        const amountEth = risk.calculatePositionSize(score, available, ethPrice);
        if (amountEth <= 0) {
          console.log(`Skipping ${symbol} — below $${MIN_TRADE_USD}`);
          continue;
        }

        const tokenAddr = TOKEN_ADDRESSES[symbol];
        if (!tokenAddr) {
          continue;
        }
        let amountsOut;
        try {
          const out = await router.getAmountsOut(
            ethers.parseEther(amountEth.toFixed(6)),
            [WETH, tokenAddr]
          );
          amountsOut = out && out[1];
        } catch (e) {
          logError(`Liquidity check failed for ${symbol} | ${e.message}`);
        }
        if (!amountsOut || amountsOut <= 0n) {
          continue;
        }
        if (paper) {
          // paper mode, no trade executed
        } else {
          try {
            await trade.buy(amountEth, [WETH, tokenAddr], symbol);
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
          // paper mode, no trade executed
        } else {
          try {
            const tokenAddr = TOKEN_ADDRESSES[symbol];
            await trade.sell(0.01, [tokenAddr, WETH], symbol);
          } catch (err) {
            logError(`Failed to trade ${symbol} \u2192 ETH | ${err.message}`);
          }
        }
        const sellMsg = reason === 'signal'
          ? `SELL ${symbol} | Score: ${score} | Price: $${price.toFixed(2)} | ${signals.join(', ')}`
          : `SELL ${symbol} triggered by ${reason} at $${price} (${pnl.toFixed(2)}%)`;
        sellMsgs.push(color(sellMsg, 'red'));
        logTrade('SELL', symbol, 0.01, price, reason, pnl);
        activeTrades[symbol] = false;
      }
    }
  }
  if (buyMsgs.length) {
    console.log(color('== BUY ==', 'green'));
    buyMsgs.forEach(m => console.log(m));
  }
  if (sellMsgs.length) {
    console.log(color('== SELL ==', 'red'));
    sellMsgs.forEach(m => console.log(m));
  }
}

async function loop() {
  try {
    console.clear();
    const prices = await getPrices();
    if (!prices) return;
    const evaluations = await evaluate(prices);
    const ethPrice = prices.eth;
    await checkTrades(evaluations.filter(e => groupA.includes(e.symbol)), ethPrice);
    const now = Date.now();
    if (now - lastGroupBCheck >= 5 * 60 * 1000) {
      await checkTrades(evaluations.filter(e => groupB.includes(e.symbol)), ethPrice);
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

