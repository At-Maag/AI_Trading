const { ethers } = require('ethers');
const fs = require('fs');
const path = require('path');
const config = require('./config');
const TOKENS = require('./tokens');
require('dotenv').config();

const routerAbi = [
  'function swapExactETHForTokens(uint amountOutMin, address[] calldata path, address to, uint deadline) payable returns (uint[] memory amounts)',
  'function swapExactTokensForETH(uint amountIn, uint amountOutMin, address[] calldata path, address to, uint deadline) returns (uint[] memory amounts)',
  'function getAmountsOut(uint amountIn, address[] calldata path) external view returns (uint[] memory amounts)'
];

const erc20Abi = [
  'function balanceOf(address) view returns (uint256)'
];

const factoryAbi = [
  'function getPair(address tokenA, address tokenB) external view returns (address pair)'
];

const pairAbi = [
  'function getReserves() external view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)',
  'function token0() external view returns (address)',
  'function token1() external view returns (address)'
];

const provider = new ethers.InfuraProvider('mainnet', process.env.INFURA_API_KEY);
const wallet = new ethers.Wallet(process.env.PRIVATE_KEY, provider);
const walletAddress = ethers.utils.getAddress(wallet.address);

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
// Uniswap V2 Router
const router = new ethers.Contract(
  ethers.utils.getAddress('0x7a250d5630b4cf539739df2c5dacb4c659f2488d'),
  routerAbi,
  wallet
);

const factoryAddress = ethers.getAddress('0x5C69bEe701ef814a2B6a3EDD4B1652CB9cc5aA6f');
const factory = new ethers.Contract(factoryAddress, factoryAbi, provider);

const WETH_ADDRESS = TOKENS.WETH;

// Decimal definitions for tokens. Default to 18, fallback to 6 if unknown
const TOKEN_DECIMALS = {
  ETH: 18,
  WETH: 18
};

function getDecimals(token) {
  const t = (token || '').toUpperCase();
  if (TOKEN_DECIMALS[t]) return TOKEN_DECIMALS[t];
  if (TOKENS[t]) return 18;
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
  const feeData = await withRetry(() => provider.getFeeData());
  const gasPrice = feeData.gasPrice || ethers.parseUnits('0', 'gwei');
  if (gasPrice > ethers.parseUnits(config.GAS_LIMIT_GWEI.toString(), 'gwei')) {
    const gwei = Number(ethers.formatUnits(gasPrice, 'gwei')).toFixed(1);
    logError(`Gas price ${gwei} gwei exceeds limit`);
    appendLog({ time: new Date().toISOString(), action: 'SKIP', reason: 'Gas high', gas: gwei });
    return false;
  }
  return true;
}

async function validateLiquidity(tokenA, tokenB) {
  try {
    const pairAddr = await withRetry(() => factory.getPair(tokenA, tokenB));
    if (pairAddr === ethers.ZeroAddress) {
      console.log('[SKIP] No Uniswap pair found');
      return false;
    }
    const pair = new ethers.Contract(pairAddr, pairAbi, provider);
    const reserves = await withRetry(() => pair.getReserves());
    const token0 = await withRetry(() => pair.token0());
    const r0 = token0.toLowerCase() === tokenA.toLowerCase() ? reserves[0] : reserves[1];
    const r1 = token0.toLowerCase() === tokenA.toLowerCase() ? reserves[1] : reserves[0];
    if (r0 === 0n || r1 === 0n) {
      console.log('[SKIP] Pair has zero reserves');
      return false;
    }
    return true;
  } catch (err) {
    console.log(`[SKIP] Liquidity validation failed: ${err.message}`);
    return false;
  }
}


async function buy(amountEth, path, token, opts = {}) {
  if (token && ['ETH', 'WETH'].includes(token.toUpperCase())) {
    return null;
  }
  console.log(`[START] Buy ${token} at ${new Date().toISOString()}`);
  if (!await gasOkay()) return null;
  const tokenAddr = TOKENS[token.toUpperCase()];
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
  if (!await validateLiquidity(WETH_ADDRESS, tokenAddr)) {
    appendLog({ time: new Date().toISOString(), action: 'SKIP', token, reason: 'liquidity' });
    return null;
  }
  try {
    const amounts = await withRetry(() =>
      router.getAmountsOut(
        parseAmount(amountEth, 'ETH'),
        swapPath
      )
    );
    if (!amounts || !amounts[1] || amounts[1] === 0n) {
      console.log(`[SKIP] Not enough liquidity for ${token}`);
      appendLog({ time: new Date().toISOString(), action: 'SKIP', token, reason: 'liquidity' });
      return null;
    }
    if (opts.simulate) {
      await withRetry(() =>
        router.swapExactETHForTokens.staticCall(
          0,
          swapPath,
          walletAddress,
          Math.floor(Date.now() / 1000) + 60 * 10,
          { value: parseAmount(Number(amountEth).toFixed(6), 'ETH') }
        )
      );
    }
  } catch (err) {
    console.log(`[SKIP] Unable to get quote for ${token}: ${err.message}`);
    appendLog({ time: new Date().toISOString(), action: 'SKIP', token, reason: 'liquidity' });
    return null;
  }
  try {
    const amt = Number(amountEth).toFixed(6);
    console.log(`[BUY] ${amt} WETH \u2192 ${token}`);
    const gasEst = await withRetry(() => router.swapExactETHForTokens.estimateGas(
      0,
      swapPath,
      walletAddress,
      Math.floor(Date.now() / 1000) + 60 * 10,
      { value: parseAmount(amt, 'ETH') }
    ));
    console.log(`[GAS] Estimated ${Number(gasEst)} units`);
    const tx = await withRetry(() =>
      router.swapExactETHForTokens(
        0,
        swapPath,
        walletAddress,
        Math.floor(Date.now() / 1000) + 60 * 10,
        { value: parseAmount(amt, 'ETH') }
      )
    );
    const receipt = await tx.wait();
    appendLog({ time: new Date().toISOString(), action: 'BUY', token, amountEth: amt, tx: tx.hash });
    return receipt;
  } catch (err) {
    const hash = err.transactionHash || (err.transaction && err.transaction.hash);
    logError(`Failed to trade ETH \u2192 ${token} | ${err.message} ${hash ? '| tx ' + hash : ''}`);
    throw err;
  }
}

async function sell(amountToken, path, token, opts = {}) {
  if (token && ['ETH', 'WETH'].includes(token.toUpperCase())) {
    return null;
  }
  console.log(`[START] Sell ${token} at ${new Date().toISOString()}`);
  if (!await gasOkay()) return null;
  const tokenAddr = TOKENS[token.toUpperCase()];
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
  if (!await validateLiquidity(tokenAddr, WETH_ADDRESS)) {
    appendLog({ time: new Date().toISOString(), action: 'SKIP', token, reason: 'liquidity' });
    return null;
  }
  try {
    const amounts = await withRetry(() =>
      router.getAmountsOut(
        parseAmount(amountToken, token),
        swapPath
      )
    );
    if (!amounts || !amounts[1] || amounts[1] === 0n) {
      console.log(`[SKIP] Not enough liquidity for ${token}`);
      appendLog({ time: new Date().toISOString(), action: 'SKIP', token, reason: 'liquidity' });
      return null;
    }
    if (opts.simulate) {
      await withRetry(() =>
        router.swapExactTokensForETH.staticCall(
          parseAmount(Number(amountToken).toFixed(6), token),
          0,
          swapPath,
          walletAddress,
          Math.floor(Date.now() / 1000) + 60 * 10
        )
      );
    }
  } catch (err) {
    console.log(`[SKIP] Unable to get quote for ${token}: ${err.message}`);
    appendLog({ time: new Date().toISOString(), action: 'SKIP', token, reason: 'liquidity' });
    return null;
  }
  try {
    const amt = Number(amountToken).toFixed(6);
    console.log(`[SELL] ${token} \u2192 WETH`);
    const gasEst = await withRetry(() => router.swapExactTokensForETH.estimateGas(
      parseAmount(amt, token),
      0,
      swapPath,
      walletAddress,
      Math.floor(Date.now() / 1000) + 60 * 10
    ));
    console.log(`[GAS] Estimated ${Number(gasEst)} units`);
    const tx = await withRetry(() =>
      router.swapExactTokensForETH(
        parseAmount(amt, token),
        0,
        swapPath,
        walletAddress,
        Math.floor(Date.now() / 1000) + 60 * 10
      )
    );
    const receipt = await tx.wait();
    appendLog({ time: new Date().toISOString(), action: 'SELL', token, amountToken: amt, tx: tx.hash });
    return receipt;
  } catch (err) {
    const hash = err.transactionHash || (err.transaction && err.transaction.hash);
    logError(`Failed to trade ${token} \u2192 ETH | ${err.message} ${hash ? '| tx ' + hash : ''}`);
    throw err;
  }
}

async function getEthBalance() {
  const bal = await provider.getBalance(walletAddress);
  return Number(ethers.formatEther(bal));
}

module.exports = { buy, sell, getEthBalance };
