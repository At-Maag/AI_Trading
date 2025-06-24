const { ethers, getAddress } = require('ethers');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const config = require('./config');
const TOKENS = require('./tokens');
const { ID_MAP } = require('./datafeeds');
require('dotenv').config();
const DRY_RUN = process.env.DRY_RUN === 'true';
const DEBUG_PAIRS = process.env.DEBUG_PAIRS === 'true';
const MIN_TRADE_USD = 10;
const MIN_BUY_USD = 5;
const MIN_WETH_BAL = 0.005;
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

async function getTokenUsdPrice(symbol) {
  const id = ID_MAP[symbol.toUpperCase()];
  if (!id) return null;
  try {
    const { data } = await axios.get(
      'https://api.coingecko.com/api/v3/simple/price',
      { params: { ids: id, vs_currencies: 'usd' }, timeout: 10000 }
    );
    return data[id]?.usd || null;
  } catch (err) {
    console.warn(`\u274c ${symbol} price fetch failed: ${err.message}`);
    return null;
  }
}

// Minimal ABI for Uniswap V3 router
const routerAbi = [
  'function exactInputSingle((address tokenIn,address tokenOut,uint24 fee,address recipient,uint256 amountIn,uint256 amountOutMinimum,uint160 sqrtPriceLimitX96)) payable returns (uint256 amountOut)'
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

const v3PoolAbi = [
  'function token0() view returns (address)',
  'function token1() view returns (address)'
];

// Connect to Arbitrum
const provider = new ethers.JsonRpcProvider('https://arb1.arbitrum.io/rpc');
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
// Uniswap V3 Universal Router on Arbitrum
const router = new ethers.Contract(
  getAddress('0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45'),
  routerAbi,
  wallet
);

const v3FactoryAbi = [
  'function getPool(address tokenA, address tokenB, uint24 fee) view returns (address)'
];
const v3FactoryAddress = getAddress('0x1F98431c8ad98523631AE4a59f267346ea31F984');
const v3Factory = new ethers.Contract(v3FactoryAddress, v3FactoryAbi, provider);
const FEE_TIERS = [500, 3000, 10000]; // 0.05%, 0.3%, 1%

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

// Convenience wrapper using token symbol
async function getBalance(symbol, account = walletAddress) {
  const addr = TOKENS[symbol.toUpperCase()];
  if (!addr) return 0;
  return getTokenBalance(addr, account, symbol);
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

async function swapExactTokenForToken({ inputToken, outputToken, amountIn, slippage }) {
  const inAddr = TOKENS[inputToken.toUpperCase()];
  let outAddr = TOKENS[outputToken.toUpperCase()];
  if (outputToken === 'ETH') outAddr = WETH_ADDRESS;
  if (!inAddr || !outAddr) throw new Error('Invalid token symbol');
  const amountParsed = parseAmount(amountIn, inputToken);
  await ensureAllowance(inAddr, inputToken, amountParsed);

  const params = {
    tokenIn: inAddr,
    tokenOut: outAddr,
    fee: 3000,
    recipient: walletAddress,
    deadline: Math.floor(Date.now() / 1000) + 60 * 10,
    amountIn: amountParsed,
    amountOutMinimum: 0,
    sqrtPriceLimitX96: 0
  };
  return router.exactInputSingle(params);
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

async function getPairAddress(tokenA, tokenB) {
  for (const fee of FEE_TIERS) {
    try {
      const pool = await withRetry(() => v3Factory.getPool(tokenA, tokenB, fee));
      if (pool && pool !== ethers.ZeroAddress) {
        if (DEBUG_PAIRS) {
          console.log(`[PAIR] V3 pool ${fee} found for ${tokenA} ${tokenB}`);
        }
        return { address: pool, version: 'v3' };
      }
    } catch (err) {
      if (DEBUG_PAIRS) {
        console.log(`[PAIR] V3 search failed (${fee}): ${err.message}`);
      }
    }
  }
  try {
    const pair = await withRetry(() => factory.getPair(tokenA, tokenB));
    if (pair && pair !== ethers.ZeroAddress) {
      if (DEBUG_PAIRS) {
        console.log(`[PAIR] V2 pair found for ${tokenA} ${tokenB}`);
      }
      return { address: pair, version: 'v2' };
    }
    if (DEBUG_PAIRS) {
      console.log(`[PAIR] No pair found for ${tokenA} ${tokenB}`);
    }
  } catch (err) {
    if (DEBUG_PAIRS) {
      console.log(`[PAIR] V2 search failed: ${err.message}`);
    }
  }
  return { address: ethers.ZeroAddress, version: null };
}

async function validateLiquidity(tokenA, tokenB, symbol) {
  try {
    const { address: pairAddr, version } = await getPairAddress(tokenA, tokenB);
    if (pairAddr === ethers.ZeroAddress) {
      console.log(`\u274c No Uniswap pair found`);
      return false;
    }
    let reserve;
    if (version === 'v3') {
      const pool = new ethers.Contract(pairAddr, v3PoolAbi, provider);
      const token0 = await withRetry(() => pool.token0());
      const token1 = await withRetry(() => pool.token1());
      const c0 = new ethers.Contract(token0, erc20Abi, provider);
      const c1 = new ethers.Contract(token1, erc20Abi, provider);
      const bal0 = await withRetry(() => c0.balanceOf(pairAddr));
      const bal1 = await withRetry(() => c1.balanceOf(pairAddr));
      reserve = token0.toLowerCase() === tokenA.toLowerCase() ? bal0 : bal1;
    } else {
      const pair = new ethers.Contract(pairAddr, pairAbi, provider);
      const reserves = await withRetry(() => pair.getReserves());
      const token0 = await withRetry(() => pair.token0());
      reserve = token0.toLowerCase() === tokenA.toLowerCase() ? reserves[0] : reserves[1];
    }
    if (reserve === 0n) {
      console.log(`\u274c Pair has zero reserves`);
      return false;
    }
    const ethPrice = await getEthPrice();
    const wethAmt = Number(ethers.formatEther(reserve));
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


async function buy(token, opts = {}) {
  if (token && ['ETH', 'WETH'].includes(token.toUpperCase())) {
    return { success: false, reason: 'invalid-token' };
  }

  if (!await gasOkay()) return { success: false, reason: 'gas' };

  const tokenAddr = TOKENS[token.toUpperCase()];
  if (!tokenAddr) {
    console.log('Token address is null, skipping trade.');
    return { success: false, reason: 'no-address' };
  }

  const wethBal = await getTokenBalance(WETH_ADDRESS, walletAddress, 'WETH');
  if (wethBal < MIN_WETH_BAL) {
    console.log(`🕒 [${localTime()}] ⚠️ Not enough WETH to trade`);
    return { success: false, reason: 'balance' };
  }

  const amountEth = wethBal * 0.15;
  const ethPrice = await getEthPrice();
  if (amountEth <= 0 || (ethPrice && amountEth * ethPrice < MIN_BUY_USD)) {
    console.log(`🕒 [${localTime()}] ⚠️ Trade amount below $${MIN_BUY_USD}`);
    return { success: false, reason: 'amount' };
  }

  if (!await validateLiquidity(WETH_ADDRESS, tokenAddr, token)) {
    appendLog({ time: new Date().toISOString(), action: 'SKIP', token, reason: 'liquidity' });
    return { success: false, reason: 'liquidity' };
  }

  const wethContract = new ethers.Contract(WETH_ADDRESS, erc20Abi, wallet);
  const allowance = await wethContract.allowance(walletAddress, router.target);
  const amountParsed = parseAmount(amountEth, 'WETH');

  if (allowance === 0n) {
    console.log(`🕒 [${localTime()}] 🟢 Approving WETH...`);
    const approvalTx = await wethContract.approve(router.target, amountParsed);
    await approvalTx.wait();
  }

  console.log(`🕒 [${localTime()}] 🟢 Swapping WETH for ${token}...`);
  const before = await getTokenBalance(tokenAddr, walletAddress, token);
  const params = {
    tokenIn: WETH_ADDRESS,
    tokenOut: tokenAddr,
    fee: 3000,
    recipient: walletAddress,
    amountIn: amountParsed,
    amountOutMinimum: 0,
    sqrtPriceLimitX96: 0,
    deadline: Math.floor(Date.now() / 1000) + 60 * 10
  };
  const tx = await router.exactInputSingle(params);
  const receipt = await tx.wait();
  console.log(`🕒 [${localTime()}] ✅ TX confirmed: ${tx.hash}`);

  const after = await getTokenBalance(tokenAddr, walletAddress, token);
  const received = after - before;
  if (received <= 0) {
    console.log(`🕒 [${localTime()}] ❌ Buy failed – no ${token} received`);
    return { success: false, reason: 'no-tokens' };
  }

  console.log(`🕒 [${localTime()}] ✅ Bought ${received.toFixed(2)} ${token}`);
  appendLog({ time: new Date().toISOString(), action: 'BUY', token, amountEth: amountEth.toFixed(6), tx: tx.hash });
  return { success: true, tx: tx.hash };
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

  const usdPrice = await getTokenUsdPrice(token);
  if (usdPrice && amountToken * usdPrice < MIN_TRADE_USD) {
    console.log(`[SKIP] ${token} sell amount $${(amountToken * usdPrice).toFixed(2)} is below $${MIN_TRADE_USD} limit`);
    return { success: false, reason: 'amount' };
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
    const tradeValueUsd = wethOut * (ethPrice || 0);
    if (tradeValueUsd < MIN_TRADE_USD) {
      console.log(`[SKIP] ${token} sell amount $${tradeValueUsd.toFixed(2)} is below $${MIN_TRADE_USD} limit`);
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

// Simplified sell logic using the universal router
async function sellToken(token) {
  const balance = await getBalance(token);

  if (!balance || balance === 0) {
    console.log(`\u2718 No ${token} balance to sell`);
    return { success: false, reason: 'no_balance' };
  }

  const tokenPrice = await getTokenUsdPrice(token);
  const tradeValueUsd = balance * (tokenPrice || 0);

  if (tradeValueUsd < 10) {
    console.log(`[SKIP] ${token} sell value is $${tradeValueUsd.toFixed(2)}, below $10 threshold`);
    return { success: false, reason: 'too_small' };
  }

  const ethBalance = parseFloat(ethers.formatEther(await provider.getBalance(wallet.address)));
  const GAS_THRESHOLD = 0.005;
  const receiveToken = ethBalance < GAS_THRESHOLD ? 'ETH' : 'WETH';

  console.log(`\u2022 Selling ${token} \u2192 ${receiveToken}`);
  console.log(`\u2022 Token Balance: ${balance}`);
  console.log(`\u2022 Token Price: $${tokenPrice}`);
  console.log(`\u2022 Est. Value: $${tradeValueUsd.toFixed(2)}`);
  console.log(`\u2022 ETH for Gas: ${ethBalance} ETH`);

  try {
    const tx = await swapExactTokenForToken({
      inputToken: token,
      outputToken: receiveToken,
      amountIn: balance,
      slippage: 0.005
    });
    if (tx) {
      console.log(`\u2713 Swap TX sent: ${tx.hash}`);
      return { success: true, tx };
    }
  } catch (err) {
    console.log(`\u2718 Swap failed`);
    return { success: false, reason: 'swap_failed' };
  }
  console.log(`\u2718 Swap failed`);
  return { success: false, reason: 'swap_failed' };
}

async function getWethBalance() {
  return getTokenBalance(WETH_ADDRESS, walletAddress, 'WETH');
}

module.exports = { buy, sellToken, getWethBalance };
