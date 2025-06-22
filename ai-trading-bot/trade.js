const { ethers } = require('ethers');
const fs = require('fs');
const path = require('path');
const config = require('./config');
require('dotenv').config();

const routerAbi = [
  'function swapExactETHForTokens(uint amountOutMin, address[] calldata path, address to, uint deadline) payable returns (uint[] memory amounts)',
  'function swapExactTokensForETH(uint amountIn, uint amountOutMin, address[] calldata path, address to, uint deadline) returns (uint[] memory amounts)',
  'function getAmountsOut(uint amountIn, address[] calldata path) external view returns (uint[] memory amounts)'
];

const erc20Abi = [
  'function balanceOf(address) view returns (uint256)'
];

const provider = new ethers.InfuraProvider('mainnet', process.env.INFURA_API_KEY);
const wallet = new ethers.Wallet(process.env.PRIVATE_KEY, provider);
// Uniswap V2 Router
const router = new ethers.Contract('0x7a250d5630B4cF539739df2C5dAcb4c659F2488D', routerAbi, wallet);

const WETH_ADDRESS = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2';
const TOKEN_ADDRESS_MAP = {
  LINK: '0x514910771AF9Ca656af840dff83E8264EcF986CA',
  UNI: '0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984',
  MATIC: '0x7d1afa7b718fb893db30a3abc0cfc608aacfebb0',
  WBTC: '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599',
  AAVE: '0x7Fc66500c84A76Ad7e9c93437bFc5Ac33E2DDaE9',
  COMP: '0xc00e94Cb662C3520282E6f5717214004A7f26888',
  SNX: '0xC011A72400E58ecD99Ee497CF89E3775d4bd732F',
  SUSHI: '0x6B3595068778dd592e39A122f4f5a5CF09C90fE2',
  LDO: '0x5A98FcBEA516Cf06857215779Fd812CA3beF1B32',
  MKR: '0x9f8F72aa9304c8B593d555F12eF6589Cc3A579A2',
  CRV: '0xD533a949740bb3306d119CC777fa900bA034cd52',
  GRT: '0xc944E90C64B2c07662A292be6244BDf05Cda44a7',
  '1INCH': '0x111111111117dC0aa78b770fA6A738034120C302',
  DYDX: '0x92D6C1e31e14520e676a687F0a93788B716BEff5',
  BAL: '0xba100000625a3754423978a60c9317c58a424e3D',
  BNT: '0x1f573d6fb3f13d689ff844b4c6deebd4994e9e6f',
  OCEAN: '0x967da4048cd07ab37855c090aaf366e4ce1b9f48',
  BAND: '0xba11d479a30a3DbA9281e1D8E6cE942Ca109b3A6',
  RLC: '0x607F4C5BB672230e8672085532f7e901544a7375',
  AMPL: '0xd46ba6D942050d489DBd938a2c3d573929F443ac',
  STORJ: '0xb64ef51c888972c908cfacf59b47c1afbc0ab8ac'
};

// Decimal definitions for tokens. Default to 18, fallback to 6 if unknown
const TOKEN_DECIMALS = {
  ETH: 18,
  WETH: 18
};

function getDecimals(token) {
  const t = (token || '').toUpperCase();
  if (TOKEN_DECIMALS[t]) return TOKEN_DECIMALS[t];
  if (TOKEN_ADDRESS_MAP[t]) return 18;
  return 6;
}

function parseAmount(amount, token) {
  const decimals = getDecimals(token);
  const tradeAmount = ethers.parseUnits(Number(amount).toFixed(6), decimals || 18);
  return tradeAmount;
}

async function getTokenBalance(tokenAddr, account, symbol) {
  try {
    const contract = new ethers.Contract(tokenAddr, erc20Abi, provider);
    const bal = await contract.balanceOf(account);
    return Number(ethers.formatUnits(bal, getDecimals(symbol)));
  } catch {
    return 0;
  }
}

const errorLogPath = path.join(__dirname, '..', 'logs', 'error-log.txt');

function logError(err) {
  try { fs.mkdirSync(path.dirname(errorLogPath), { recursive: true }); } catch {}
  const ts = new Date().toISOString();
  const msg = err instanceof Error ? err.stack || err.message : err;
  fs.appendFileSync(errorLogPath, `[${ts}] ${msg}\n`);
  console.error(msg);
}

const logPath = path.join(__dirname, '..', 'data', 'trade-log.json');
const tradeLogTxt = path.join(__dirname, '..', 'logs', 'trade-log.txt');

function appendLog(entry) {
  try { fs.mkdirSync(path.dirname(logPath), { recursive: true }); } catch {}
  let data = [];
  try { data = JSON.parse(fs.readFileSync(logPath)); } catch {}
  data.push(entry);
  fs.writeFileSync(logPath, JSON.stringify(data, null, 2));

  try { fs.mkdirSync(path.dirname(tradeLogTxt), { recursive: true }); } catch {}
  let line = `[${entry.time}] ${entry.action}`;
  if (entry.token) line += ` ${entry.token}`;
  if (entry.amountEth) line += ` ${entry.amountEth}`;
  if (entry.amountToken) line += ` ${entry.amountToken}`;
  if (entry.reason) line += ` (${entry.reason})`;
  fs.appendFileSync(tradeLogTxt, line + '\n');
}

async function gasOkay() {
  const feeData = await provider.getFeeData();
  const gasPrice = feeData.gasPrice || ethers.parseUnits('0', 'gwei');
  if (gasPrice > ethers.parseUnits(config.GAS_LIMIT_GWEI.toString(), 'gwei')) {
    const gwei = Number(ethers.formatUnits(gasPrice, 'gwei')).toFixed(1);
    logError(`Gas price ${gwei} gwei exceeds limit`);
    appendLog({ time: new Date().toISOString(), action: 'SKIP', reason: 'Gas high', gas: gwei });
    return false;
  }
  return true;
}

async function hasLiquidity(amountEth, token) {
  const tokenAddr = TOKEN_ADDRESS_MAP[token.toUpperCase()];
  if (!tokenAddr) return false;
  try {
    const amounts = await router.getAmountsOut(
      parseAmount(amountEth, 'ETH'),
      [WETH_ADDRESS, tokenAddr]
    );
    return amounts && amounts[1] && amounts[1] > 0n;
  } catch {
    return false;
  }
}

async function hasLiquidityForSell(amountToken, token) {
  const tokenAddr = TOKEN_ADDRESS_MAP[token.toUpperCase()];
  if (!tokenAddr) return false;
  try {
    const amounts = await router.getAmountsOut(
      parseAmount(amountToken, token),
      [tokenAddr, WETH_ADDRESS]
    );
    return amounts && amounts[1] && amounts[1] > 0n;
  } catch {
    return false;
  }
}

async function buy(amountEth, path, token, opts = {}) {
  if (token && ['ETH', 'WETH'].includes(token.toUpperCase())) {
    return null;
  }
  if (!await gasOkay()) return null;
  const tokenAddr = TOKEN_ADDRESS_MAP[token.toUpperCase()];
  const swapPath = [WETH_ADDRESS, tokenAddr];
  const wethBal = await getTokenBalance(WETH_ADDRESS, wallet.address, 'WETH');
  if (amountEth > wethBal) {
    console.log(`[SKIP] Not enough WETH for ${token}`);
    return null;
  }
  if (opts.simulate) {
    try {
      await router.swapExactETHForTokens.staticCall(
        0,
        swapPath,
        wallet.address,
        Math.floor(Date.now() / 1000) + 60 * 10,
        { value: parseAmount(Number(amountEth).toFixed(6), 'ETH') }
      );
    } catch {
      console.log(`[SKIP] Not enough liquidity or trade amount too low for ${token}`);
      appendLog({ time: new Date().toISOString(), action: 'SKIP', token, reason: 'liquidity' });
      return null;
    }
  }
  try {
    const amt = Number(amountEth).toFixed(6);
    console.log(`[BUY] ${amt} WETH \u2192 ${token} \u2705`);
    const tx = await router.swapExactETHForTokens(
      0,
      swapPath,
      wallet.address,
      Math.floor(Date.now() / 1000) + 60 * 10,
      { value: parseAmount(amt, 'ETH') }
    );
    const receipt = await tx.wait();
    appendLog({ time: new Date().toISOString(), action: 'BUY', token, amountEth: amt, tx: tx.hash });
    return receipt;
  } catch (err) {
    logError(`Failed to trade ETH \u2192 ${token} | ${err.stack || err}`);
    throw err;
  }
}

async function sell(amountToken, path, token, opts = {}) {
  if (token && ['ETH', 'WETH'].includes(token.toUpperCase())) {
    return null;
  }
  if (!await gasOkay()) return null;
  const tokenAddr = TOKEN_ADDRESS_MAP[token.toUpperCase()];
  const swapPath = [tokenAddr, WETH_ADDRESS];
  const bal = await getTokenBalance(tokenAddr, wallet.address, token);
  if (amountToken > bal) {
    console.log(`[SKIP] Not enough ${token} to sell`);
    return null;
  }
  if (opts.simulate) {
    try {
      await router.swapExactTokensForETH.staticCall(
        parseAmount(Number(amountToken).toFixed(6), token),
        0,
        swapPath,
        wallet.address,
        Math.floor(Date.now() / 1000) + 60 * 10
      );
    } catch {
      console.log(`[SKIP] Not enough liquidity or trade amount too low for ${token}`);
      appendLog({ time: new Date().toISOString(), action: 'SKIP', token, reason: 'liquidity' });
      return null;
    }
  } else if (!await hasLiquidityForSell(amountToken, token)) {
    appendLog({ time: new Date().toISOString(), action: 'SKIP', token, reason: 'liquidity' });
    return null;
  }
  try {
    const amt = Number(amountToken).toFixed(6);
    console.log(`[SELL] ${token} \u2192 WETH \u2705`);
    const tx = await router.swapExactTokensForETH(
      parseAmount(amt, token),
      0,
      swapPath,
      wallet.address,
      Math.floor(Date.now() / 1000) + 60 * 10
    );
    const receipt = await tx.wait();
    appendLog({ time: new Date().toISOString(), action: 'SELL', token, amountToken: amt, tx: tx.hash });
    return receipt;
  } catch (err) {
    logError(`Failed to trade ${token} \u2192 ETH | ${err.stack || err}`);
    throw err;
  }
}

async function getEthBalance() {
  const bal = await provider.getBalance(wallet.address);
  return Number(ethers.formatEther(bal));
}

module.exports = { buy, sell, getEthBalance };
