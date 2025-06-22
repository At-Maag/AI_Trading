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
const walletAddress = ethers.utils.getAddress(wallet.address);
// Uniswap V2 Router
const router = new ethers.Contract(
  ethers.utils.getAddress('0x7a250d5630b4cf539739df2c5dacb4c659f2488d'),
  routerAbi,
  wallet
);

const WETH_ADDRESS = ethers.utils.getAddress('0xC02aaA39b223fe8d0a0e5c4f27ead9083c756cc2');
const TOKEN_ADDRESS_MAP = {
  LINK: ethers.utils.getAddress('0x514910771af9ca656af840dff83e8264ecf986ca'),
  UNI: ethers.utils.getAddress('0x1f9840a85d5af5bf1d1762f925bdaddc4201f984'),
  MATIC: ethers.utils.getAddress('0x7d1afa7b718fb893db30a3abc0cfc608aacfebb0'),
  WBTC: ethers.utils.getAddress('0x2260fac5e5542a773aa44fbcfedf7c193bc2c599'),
  AAVE: ethers.utils.getAddress('0x7fc66500c84a76ad7e9c93437bfc5ac33e2ddae9'),
  COMP: ethers.utils.getAddress('0xc00e94cb662c3520282e6f5717214004a7f26888'),
  SNX: ethers.utils.getAddress('0xc011a72400e58ecd99ee497cf89e3775d4bd732f'),
  SUSHI: ethers.utils.getAddress('0x6b3595068778dd592e39a122f4f5a5cf09c90fe2'),
  LDO: ethers.utils.getAddress('0x5a98fcbea516cf06857215779fd812ca3bef1b32'),
  MKR: ethers.utils.getAddress('0x9f8f72aa9304c8b593d555f12ef6589cc3a579a2'),
  CRV: ethers.utils.getAddress('0xd533a949740bb3306d119cc777fa900ba034cd52'),
  GRT: ethers.utils.getAddress('0xc944e90c64b2c07662a292be6244bdf05cda44a7'),
  '1INCH': ethers.utils.getAddress('0x111111111117dc0aa78b770fa6a738034120c302'),
  DYDX: ethers.utils.getAddress('0x92d6c1e31e14520e676a687f0a93788b716beff5'),
  BAL: ethers.utils.getAddress('0xba100000625a3754423978a60c9317c58a424e3d'),
  BNT: ethers.utils.getAddress('0x1f573d6fb3f13d689ff844b4c6deebd4994e9e6f'),
  OCEAN: ethers.utils.getAddress('0x967da4048cd07ab37855c090aaf366e4ce1b9f48'),
  BAND: ethers.utils.getAddress('0xba11d479a30a3dba9281e1d8e6ce942ca109b3a6'),
  RLC: ethers.utils.getAddress('0x607f4c5bb672230e8672085532f7e901544a7375'),
  AMPL: ethers.utils.getAddress('0xd46ba6d942050d489dbd938a2c3d573929f443ac'),
  STORJ: ethers.utils.getAddress('0xb64ef51c888972c908cfacf59b47c1afbc0ab8ac')
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
  if (!tokenAddr) {
    console.log("Token address is null, skipping trade.");
    return null;
  }
  const swapPath = [WETH_ADDRESS, tokenAddr];
  const wethBal = await getTokenBalance(WETH_ADDRESS, walletAddress, 'WETH');
  if (amountEth > wethBal) {
    console.log(`[SKIP] Not enough WETH for ${token}`);
    return null;
  }
  try {
    const amounts = await router.getAmountsOut(
      parseAmount(amountEth, 'ETH'),
      swapPath
    );
    if (!amounts || !amounts[1] || amounts[1] === 0n) {
      console.log(`[SKIP] Not enough liquidity for ${token}`);
      appendLog({ time: new Date().toISOString(), action: 'SKIP', token, reason: 'liquidity' });
      return null;
    }
    if (opts.simulate) {
      await router.swapExactETHForTokens.staticCall(
        0,
        swapPath,
        walletAddress,
        Math.floor(Date.now() / 1000) + 60 * 10,
        { value: parseAmount(Number(amountEth).toFixed(6), 'ETH') }
      );
    }
  } catch (err) {
    console.log(`[SKIP] Unable to get quote for ${token}: ${err.message}`);
    appendLog({ time: new Date().toISOString(), action: 'SKIP', token, reason: 'liquidity' });
    return null;
  }
  try {
    const amt = Number(amountEth).toFixed(6);
    console.log(`[BUY] ${amt} WETH \u2192 ${token} \u2705`);
    const tx = await router.swapExactETHForTokens(
      0,
      swapPath,
      walletAddress,
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
  if (!tokenAddr) {
    console.log("Token address is null, skipping trade.");
    return null;
  }
  const swapPath = [tokenAddr, WETH_ADDRESS];
  const bal = await getTokenBalance(tokenAddr, walletAddress, token);
  if (amountToken > bal) {
    console.log(`[SKIP] Not enough ${token} to sell`);
    return null;
  }
  try {
    const amounts = await router.getAmountsOut(
      parseAmount(amountToken, token),
      swapPath
    );
    if (!amounts || !amounts[1] || amounts[1] === 0n) {
      console.log(`[SKIP] Not enough liquidity for ${token}`);
      appendLog({ time: new Date().toISOString(), action: 'SKIP', token, reason: 'liquidity' });
      return null;
    }
    if (opts.simulate) {
      await router.swapExactTokensForETH.staticCall(
        parseAmount(Number(amountToken).toFixed(6), token),
        0,
        swapPath,
        walletAddress,
        Math.floor(Date.now() / 1000) + 60 * 10
      );
    }
  } catch (err) {
    console.log(`[SKIP] Unable to get quote for ${token}: ${err.message}`);
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
      walletAddress,
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
  const bal = await provider.getBalance(walletAddress);
  return Number(ethers.formatEther(bal));
}

module.exports = { buy, sell, getEthBalance };
