const { ethers, getAddress } = require('ethers');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const config = require('./config');
const TOKENS = require('./tokens');
require('dotenv').config();
const DRY_RUN = process.env.DRY_RUN === 'true';
const MIN_TRADE_USD = 10;
const MIN_RECEIVE_TOKENS = 0.001;

function localTime() {
  return new Date().toLocaleTimeString('en-US', {
    timeZone: 'America/Los_Angeles',
    hour12: true,
    hour: '2-digit',
    minute: '2-digit',
    timeZoneName: 'short'
  });
}

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
const SLIPPAGE_BPS = BigInt(Math.round((config.SLIPPAGE || 0.01) * 10000));

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
  const ts = localTime();
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
  let line = `[${localTime()}] ${entry.action}`;
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
    return { success: false, reason: 'invalid-token' };
  }
  console.log(`🔥 Buy ${token} at ${localTime()}`);
  if (!await gasOkay()) return { success: false, reason: 'gas' };
  const ethPrice = await getEthPrice();
  if (ethPrice && amountEth * ethPrice < MIN_TRADE_USD) {
    console.log(`[TRADE] Skipped ${token}: trade amount below $${MIN_TRADE_USD}`);
    return { success: false, reason: 'amount' };
  }
  const tokenAddr = TOKENS[token.toUpperCase()];
  if (!tokenAddr) {
    console.log("Token address is null, skipping trade.");
    return { success: false, reason: 'no-address' };
  }
  const swapPath = [WETH_ADDRESS, tokenAddr];
  const wethBal = await getTokenBalance(WETH_ADDRESS, walletAddress, 'WETH');
  if (amountEth > wethBal) {
    console.log(`\u274c Not enough WETH for ${token}`);
    return { success: false, reason: 'balance' };
  }
  if (!await validateLiquidity(WETH_ADDRESS, tokenAddr, token)) {
    appendLog({ time: new Date().toISOString(), action: 'SKIP', token, reason: 'liquidity' });
    return { success: false, reason: 'liquidity' };
  }
  await ensureAllowance(WETH_ADDRESS, 'WETH', parseAmount(amountEth, 'WETH'));
  let minOut;
  let expectedOut;
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
      return { success: false, reason: 'liquidity' };
    }
    expectedOut = amounts[1];
    minOut = amounts[1] * (10000n - SLIPPAGE_BPS) / 10000n;
    if (opts.simulate || opts.dryRun || DRY_RUN) {
      await withRetry(() =>
        router.swapExactTokensForTokens.staticCall(
          parseAmount(Number(amountEth).toFixed(6), 'WETH'),
          minOut,
          swapPath,
          walletAddress,
          Math.floor(Date.now() / 1000) + 60 * 10
        )
      );
      return { success: true, simulated: true };
    }
  } catch (err) {
    console.log(`\u274c Unable to get quote for ${token}: ${err.message}`);
    appendLog({ time: new Date().toISOString(), action: 'SKIP', token, reason: 'liquidity' });
    return { success: false, reason: 'liquidity' };
  }
  try {
    const amt = Number(amountEth).toFixed(6);
    console.log(`[BUY] ${amt} WETH → ${token}`);
    const gasEst = await withRetry(() => router.swapExactTokensForTokens.estimateGas(
      parseAmount(amt, 'WETH'),
      minOut,
      swapPath,
      walletAddress,
      Math.floor(Date.now() / 1000) + 60 * 10
    ));
    console.log(`[GAS] Estimated ${Number(gasEst)} units`);
    if (opts.dryRun || DRY_RUN) {
      console.log('\u267B Dry run - transaction not sent');
      appendLog({ time: new Date().toISOString(), action: 'DRY-BUY', token, amountEth: amt });
      return { success: true, simulated: true };
    }
    const beforeBal = await getTokenBalance(tokenAddr, walletAddress, token);
    const tx = await withRetry(() =>
      router.swapExactTokensForTokens(
        parseAmount(amt, 'WETH'),
        minOut,
        swapPath,
        walletAddress,
        Math.floor(Date.now() / 1000) + 60 * 10
      )
    );
    const receipt = await tx.wait();
    const afterBal = await getTokenBalance(tokenAddr, walletAddress, token);
    const diff = afterBal - beforeBal;
    let message;
    let success = true;
    const ethPrice = await getEthPrice();
    let tokenValueUsd = 0;
    try {
      const expectedTokens = Number(ethers.formatUnits(expectedOut || 0n, getDecimals(token)));
      const pricePerToken = expectedTokens ? (Number(amountEth) * (ethPrice || 0)) / expectedTokens : 0;
      tokenValueUsd = diff * pricePerToken;
    } catch {}
    if (diff <= 0 || (diff < MIN_RECEIVE_TOKENS && tokenValueUsd < 1)) {
      success = false;
      message = `❌ Buy failed or too small`;
    } else {
      message = `✅ Bought ${diff.toFixed(2)} ${token} | TX: ${tx.hash}`;
    }
    console.log(message);
    appendLog({ time: new Date().toISOString(), action: 'BUY', token, amountEth: amt, tx: tx.hash });
    return { success, tx: tx.hash };
  } catch (err) {
    const hash = err.transactionHash || (err.transaction && err.transaction.hash);
    logError(`Failed to trade WETH \u2192 ${token} | ${err.message} ${hash ? '|tx ' + hash : ''}`);
    console.log(`❌ Swap failed for ${token}`);
    return { success: false, reason: err.message };
  }
}

async function sell(amountToken, path, token, opts = {}) {
  if (token && ['ETH', 'WETH'].includes(token.toUpperCase())) {
    return { success: false, reason: 'invalid-token' };
  }
  console.log(`🔥 Sell ${token} at ${localTime()}`);
  if (!await gasOkay()) return { success: false, reason: 'gas' };
  const tokenAddr = TOKENS[token.toUpperCase()];
  if (!tokenAddr) {
    console.log("Token address is null, skipping trade.");
    return { success: false, reason: 'no-address' };
  }
  const swapPath = [tokenAddr, WETH_ADDRESS];
  const bal = await getTokenBalance(tokenAddr, walletAddress, token);
  if (bal <= 0) {
    console.log(`❌ No ${token} to sell`);
    return { success: false, reason: 'balance' };
  }
  if (amountToken > bal) {
    console.log(`❌ Not enough ${token} to sell`);
    return { success: false, reason: 'balance' };
  }
  if (!await validateLiquidity(tokenAddr, WETH_ADDRESS, token)) {
    appendLog({ time: new Date().toISOString(), action: 'SKIP', token, reason: 'liquidity' });
    return { success: false, reason: 'liquidity' };
  }
  await ensureAllowance(tokenAddr, token, parseAmount(amountToken, token));
  let minOut;
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
      return { success: false, reason: 'liquidity' };
    }
    const ethPrice = await getEthPrice();
    const wethOut = Number(ethers.formatEther(amounts[1]));
    if (ethPrice && wethOut * ethPrice < MIN_TRADE_USD) {
      console.log(`[TRADE] Skipped ${token}: trade amount below $${MIN_TRADE_USD}`);
      return { success: false, reason: 'amount' };
    }
    minOut = amounts[1] * (10000n - SLIPPAGE_BPS) / 10000n;
    if (opts.simulate || opts.dryRun || DRY_RUN) {
      await withRetry(() =>
        router.swapExactTokensForTokens.staticCall(
          parseAmount(Number(amountToken).toFixed(6), token),
          minOut,
          swapPath,
          walletAddress,
          Math.floor(Date.now() / 1000) + 60 * 10
        )
      );
      return { success: true, simulated: true };
    }
  } catch (err) {
    console.log(`\u274c Unable to get quote for ${token}: ${err.message}`);
    appendLog({ time: new Date().toISOString(), action: 'SKIP', token, reason: 'liquidity' });
    return { success: false, reason: 'liquidity' };
  }
  try {
    const amt = Number(amountToken).toFixed(6);
    console.log(`[SELL] ${token} → WETH`);
    const gasEst = await withRetry(() => router.swapExactTokensForTokens.estimateGas(
      parseAmount(amt, token),
      minOut,
      swapPath,
      walletAddress,
      Math.floor(Date.now() / 1000) + 60 * 10
    ));
    console.log(`[GAS] Estimated ${Number(gasEst)} units`);
    if (opts.dryRun || DRY_RUN) {
      console.log('\u267B Dry run - transaction not sent');
      appendLog({ time: new Date().toISOString(), action: 'DRY-SELL', token, amountToken: amt });
      return { success: true, simulated: true };
    }
    const beforeWeth = await getTokenBalance(WETH_ADDRESS, walletAddress, 'WETH');
    const tx = await withRetry(() =>
      router.swapExactTokensForTokens(
        parseAmount(amt, token),
        minOut,
        swapPath,
        walletAddress,
        Math.floor(Date.now() / 1000) + 60 * 10
      )
    );
    const receipt = await tx.wait();
    const afterWeth = await getTokenBalance(WETH_ADDRESS, walletAddress, 'WETH');
    const earned = afterWeth - beforeWeth;
    console.log(`✅ Sold ${token} for ${earned.toFixed(4)} WETH`);
    appendLog({ time: new Date().toISOString(), action: 'SELL', token, amountToken: amt, tx: tx.hash });
    return { success: true, tx: tx.hash };
  } catch (err) {
    const hash = err.transactionHash || (err.transaction && err.transaction.hash);
    logError(`Failed to trade ${token} \u2192 WETH | ${err.message} ${hash ? '| tx ' + hash : ''}`);
    return { success: false, reason: err.message };
  }
}

async function getWethBalance() {
  return getTokenBalance(WETH_ADDRESS, walletAddress, 'WETH');
}

module.exports = { buy, sell, getWethBalance };
