const { ethers, getAddress } = require('ethers');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const config = require('./config');
const TOKENS = require('./tokens');
require('dotenv').config();
const DRY_RUN = process.env.DRY_RUN === 'true';
const MIN_TRADE_USD = 10;

let cachedEthPrice = null;
let lastEthFetch = 0;

async function getEthPrice() {
  const now = Date.now();
  if (cachedEthPrice && now - lastEthFetch < 5 * 60 * 1000) {
    return cachedEthPrice;
  }
  try {
    const { data } = await axios.get('https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd', { timeout: 10000 });
    cachedEthPrice = data.ethereum.usd;
    lastEthFetch = now;
    return cachedEthPrice;
  } catch (err) {
    console.warn(`\u274c ETH price fetch failed: ${err.message}`);
    return cachedEthPrice;
  }
}

const routerAbi = [
  'function swapExactETHForTokens(uint amountOutMin, address[] calldata path, address to, uint deadline) payable returns (uint[] memory amounts)',
  'function swapExactTokensForETH(uint amountIn, uint amountOutMin, address[] calldata path, address to, uint deadline) returns (uint[] memory amounts)',
  'function swapExactTokensForTokens(uint amountIn, uint amountOutMin, address[] calldata path, address to, uint deadline) returns (uint[] memory amounts)',
  'function getAmountsOut(uint amountIn, address[] calldata path) external view returns (uint[] memory amounts)'
];

const erc20Abi = [
  'function balanceOf(address) view returns (uint256)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function approve(address spender, uint256 amount) returns (bool)'
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
const walletAddress = getAddress(wallet.address);

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
  getAddress('0x7a250d5630b4cf539739df2c5dacb4c659f2488d'),
  routerAbi,
  wallet
);

const factoryAddress = getAddress('0x5C69bEe701ef814a2B6a3EDD4B1652CB9cc5aA6f');
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

async function ensureAllowance(tokenAddr, symbol, amount) {
  try {
    const contract = new ethers.Contract(tokenAddr, erc20Abi, wallet);
    const current = await withRetry(() => contract.allowance(walletAddress, router.target));
    if (current < amount) {
      console.log(`[APPROVE] ${symbol}`);
      const tx = await withRetry(() => contract.approve(router.target, ethers.MaxUint256));
      await tx.wait();
    }
  } catch (err) {
    logError(`Approval failed for ${symbol} | ${err.message}`);
    throw err;
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

async function validateLiquidity(tokenA, tokenB, symbol) {
  try {
    const pairAddr = await withRetry(() => factory.getPair(tokenA, tokenB));
    if (pairAddr === ethers.ZeroAddress) {
      console.log(`\u274c No Uniswap pair found`);
      return false;
    }
    const pair = new ethers.Contract(pairAddr, pairAbi, provider);
    const reserves = await withRetry(() => pair.getReserves());
    const token0 = await withRetry(() => pair.token0());
    const r0 = token0.toLowerCase() === tokenA.toLowerCase() ? reserves[0] : reserves[1];
    if (r0 === 0n) {
      console.log(`\u274c Pair has zero reserves`);
      return false;
    }
    const ethPrice = await getEthPrice();
    const wethAmt = Number(ethers.formatEther(r0));
    if (ethPrice && wethAmt * ethPrice < 50) {
      console.log(`[LIQUIDITY] Skipped ${symbol}: liquidity < $50`);
      return false;
    }
    return true;
  } catch (err) {
    console.log(`\u274c Liquidity validation failed: ${err.message}`);
    return false;
  }
}


async function buy(amountEth, path, token, opts = {}) {
  if (token && ['ETH', 'WETH'].includes(token.toUpperCase())) {
    return null;
  }
  console.log(`\uD83D\uDD25 Buy ${token} at ${new Date().toISOString()}`);
  if (!await gasOkay()) return null;
  const ethPrice = await getEthPrice();
  if (ethPrice && amountEth * ethPrice < MIN_TRADE_USD) {
    console.log(`[TRADE] Skipped ${token}: trade amount below $${MIN_TRADE_USD}`);
    return null;
  }
  const tokenAddr = TOKENS[token.toUpperCase()];
  if (!tokenAddr) {
    console.log("Token address is null, skipping trade.");
    return null;
  }
  const swapPath = [WETH_ADDRESS, tokenAddr];
  const wethBal = await getTokenBalance(WETH_ADDRESS, walletAddress, 'WETH');
  if (amountEth > wethBal) {
    console.log(`\u274c Not enough WETH for ${token}`);
    return null;
  }
  if (!await validateLiquidity(WETH_ADDRESS, tokenAddr, token)) {
    appendLog({ time: new Date().toISOString(), action: 'SKIP', token, reason: 'liquidity' });
    return null;
  }
  await ensureAllowance(WETH_ADDRESS, 'WETH', parseAmount(amountEth, 'WETH'));
  try {
    const amounts = await withRetry(() =>
      router.getAmountsOut(
        parseAmount(amountEth, 'WETH'),
        swapPath
      )
    );
    if (!amounts || !amounts[1] || amounts[1] === 0n) {
      console.log(`\u274c Not enough liquidity for ${token}`);
      appendLog({ time: new Date().toISOString(), action: 'SKIP', token, reason: 'liquidity' });
      return null;
    }
    if (opts.simulate || opts.dryRun || DRY_RUN) {
      await withRetry(() =>
        router.swapExactTokensForTokens.staticCall(
          parseAmount(Number(amountEth).toFixed(6), 'WETH'),
          0,
          swapPath,
          walletAddress,
          Math.floor(Date.now() / 1000) + 60 * 10
        )
      );
    }
  } catch (err) {
    console.log(`\u274c Unable to get quote for ${token}: ${err.message}`);
    appendLog({ time: new Date().toISOString(), action: 'SKIP', token, reason: 'liquidity' });
    return null;
  }
  try {
    const amt = Number(amountEth).toFixed(6);
    console.log(`[BUY] ${amt} WETH \u2192 ${token}`);
    const gasEst = await withRetry(() => router.swapExactTokensForTokens.estimateGas(
      parseAmount(amt, 'WETH'),
      0,
      swapPath,
      walletAddress,
      Math.floor(Date.now() / 1000) + 60 * 10
    ));
    console.log(`[GAS] Estimated ${Number(gasEst)} units`);
    if (opts.dryRun || DRY_RUN) {
      console.log('\u267B Dry run - transaction not sent');
      appendLog({ time: new Date().toISOString(), action: 'DRY-BUY', token, amountEth: amt });
      return null;
    }
    const tx = await withRetry(() =>
      router.swapExactTokensForTokens(
        parseAmount(amt, 'WETH'),
        0,
        swapPath,
        walletAddress,
        Math.floor(Date.now() / 1000) + 60 * 10
      )
    );
    const receipt = await tx.wait();
    appendLog({ time: new Date().toISOString(), action: 'BUY', token, amountEth: amt, tx: tx.hash });
    return receipt;
  } catch (err) {
    const hash = err.transactionHash || (err.transaction && err.transaction.hash);
    logError(`Failed to trade WETH \u2192 ${token} | ${err.message} ${hash ? '| tx ' + hash : ''}`);
    throw err;
  }
}

async function sell(amountToken, path, token, opts = {}) {
  if (token && ['ETH', 'WETH'].includes(token.toUpperCase())) {
    return null;
  }
  console.log(`\uD83D\uDD25 Sell ${token} at ${new Date().toISOString()}`);
  if (!await gasOkay()) return null;
  const tokenAddr = TOKENS[token.toUpperCase()];
  if (!tokenAddr) {
    console.log("Token address is null, skipping trade.");
    return null;
  }
  const swapPath = [tokenAddr, WETH_ADDRESS];
  const bal = await getTokenBalance(tokenAddr, walletAddress, token);
  if (amountToken > bal) {
    console.log(`\u274c Not enough ${token} to sell`);
    return null;
  }
  if (!await validateLiquidity(tokenAddr, WETH_ADDRESS, token)) {
    appendLog({ time: new Date().toISOString(), action: 'SKIP', token, reason: 'liquidity' });
    return null;
  }
  await ensureAllowance(tokenAddr, token, parseAmount(amountToken, token));
  try {
    const amounts = await withRetry(() =>
      router.getAmountsOut(
        parseAmount(amountToken, token),
        swapPath
      )
    );
    if (!amounts || !amounts[1] || amounts[1] === 0n) {
      console.log(`\u274c Not enough liquidity for ${token}`);
      appendLog({ time: new Date().toISOString(), action: 'SKIP', token, reason: 'liquidity' });
      return null;
    }
    const ethPrice = await getEthPrice();
    const wethOut = Number(ethers.formatEther(amounts[1]));
    if (ethPrice && wethOut * ethPrice < MIN_TRADE_USD) {
      console.log(`[TRADE] Skipped ${token}: trade amount below $${MIN_TRADE_USD}`);
      return null;
    }
    if (opts.simulate || opts.dryRun || DRY_RUN) {
      await withRetry(() =>
        router.swapExactTokensForTokens.staticCall(
          parseAmount(Number(amountToken).toFixed(6), token),
          0,
          swapPath,
          walletAddress,
          Math.floor(Date.now() / 1000) + 60 * 10
        )
      );
    }
  } catch (err) {
    console.log(`\u274c Unable to get quote for ${token}: ${err.message}`);
    appendLog({ time: new Date().toISOString(), action: 'SKIP', token, reason: 'liquidity' });
    return null;
  }
  try {
    const amt = Number(amountToken).toFixed(6);
    console.log(`[SELL] ${token} \u2192 WETH`);
    const gasEst = await withRetry(() => router.swapExactTokensForTokens.estimateGas(
      parseAmount(amt, token),
      0,
      swapPath,
      walletAddress,
      Math.floor(Date.now() / 1000) + 60 * 10
    ));
    console.log(`[GAS] Estimated ${Number(gasEst)} units`);
    if (opts.dryRun || DRY_RUN) {
      console.log('\u267B Dry run - transaction not sent');
      appendLog({ time: new Date().toISOString(), action: 'DRY-SELL', token, amountToken: amt });
      return null;
    }
    const tx = await withRetry(() =>
      router.swapExactTokensForTokens(
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
    logError(`Failed to trade ${token} \u2192 WETH | ${err.message} ${hash ? '| tx ' + hash : ''}`);
    throw err;
  }
}

async function getWethBalance() {
  return getTokenBalance(WETH_ADDRESS, walletAddress, 'WETH');
}

module.exports = { buy, sell, getWethBalance };
