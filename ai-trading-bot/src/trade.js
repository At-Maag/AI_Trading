const { ethers, getAddress } = require('ethers');
const fs = require('fs');
const path = require('path');
const { SELL_DESTINATION } = require('./tokenManager');
const { logError } = require('./logger');
const QUOTER_V2_ADDRESS = '0x61fFE014bA17989E743c5F6cB21bF9697530B21e';
const UNISWAP_QUOTER_ABI = [
  "function quoteExactInputSingle(address tokenIn, address tokenOut, uint24 fee, uint256 amountIn, uint160 sqrtPriceLimitX96) external view returns (uint256 amountOut)"
];
// Trading parameters
const SLIPPAGE = 0.01; // 1%
const GAS_LIMIT_GWEI = 80;

// Minimal token address mapping used by trading functions. Additional tokens
// are loaded from arbitrum.tokenlist.json at runtime.
const TOKENS = {
  WETH: '0x82af49447d8a07e3bd95bd0d56f35241523fbab1'
};

const tokenListPath = path.join(__dirname, '..', 'data', 'arbitrum.tokenlist.json');

function refreshLocalTokenList() {
  try {
    const data = JSON.parse(fs.readFileSync(tokenListPath));
    if (Array.isArray(data.tokens)) {
      data.tokens.forEach(t => {
        if (ethers.isAddress(t.address)) {
          TOKENS[t.symbol.toUpperCase()] = t.address;
        }
      });
    }
  } catch {}
}

refreshLocalTokenList();
require('dotenv').config();
const DRY_RUN = process.env.DRY_RUN === 'true';
const debug_pairs = process.env.DEBUG_PAIRS === 'true';
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
  const feedAddress = '0x639Fe6ab55C921f74e7fac1ee960C0B6293ba612';
  const abi = [
    'function latestAnswer() view returns (int256)',
    'function latestRoundData() view returns (uint80 roundId,int256 answer,uint256 startedAt,uint256 updatedAt,uint80 answeredInRound)'
  ];
  const feed = new ethers.Contract(feedAddress, abi, provider);
  try {
    const price = await feed.latestAnswer();
    cachedEthPrice = Number(price) / 1e8;
  } catch (err) {
    try {
      const [, answer] = await feed.latestRoundData();
      cachedEthPrice = Number(answer) / 1e8;
    } catch (err2) {
      console.warn(`\u274c ETH price fetch failed: ${err2.message}`);
      return cachedEthPrice;
    }
  }
  lastEthFetch = now;
  return cachedEthPrice;
}

async function getTokenUsdPrice(symbol) {
  const tokenSym = (symbol || '').toUpperCase();
  const wethFeed = '0x639Fe6ab55C921f74e7fac1ee960C0B6293ba612';

  // Direct Chainlink feed for WETH
  if (tokenSym === 'WETH') {
    const feed = new ethers.Contract(wethFeed, [
      'function latestAnswer() view returns (int256)',
      'function latestRoundData() view returns (uint80 roundId,int256 answer,uint256 startedAt,uint256 updatedAt,uint80 answeredInRound)'
    ], provider);
    try {
      const raw = await feed.latestAnswer();
      return Number(raw) / 1e8;
    } catch (err) {
      try {
        const [, answer] = await feed.latestRoundData();
        return Number(answer) / 1e8;
      } catch (err2) {
        console.warn(`Price fetch failed for ${symbol}: ${err2.message}`);
        return 0;
      }
    }
  }

  const tokenAddr = TOKENS[tokenSym];
  if (!tokenAddr) {
    if (debug_pairs) console.warn(`[MISSING TOKEN] ${symbol}`);
    return 0;
  }

  if (debug_pairs) console.warn(`[NO FEED] Estimating price for ${symbol} using Uniswap + WETH`);

  const wethAddr = getWethAddress();
  const amountIn = parseAmount(1, tokenSym); // sell 1 token
  const sqrtLimit = 0;

  let wethOut = 0n;
  for (const fee of FEE_TIERS) {
    try {
      const out = await quoter.quoteExactInputSingle(
        tokenAddr,
        wethAddr,
        fee,
        amountIn,
        sqrtLimit
      );
      if (out && out !== 0n) {
        wethOut = out;
        break;
      }
    } catch (e) {
      if (debug_pairs) console.warn(`[QUOTE FAIL] ${symbol} ${fee}: ${e.message}`);
    }
  }
  if (wethOut === 0n) {
    if (debug_pairs) console.warn(`[SUSHI FALLBACK] ${symbol}`);
    try {
      const amounts = await sushiRouter.getAmountsOut(amountIn, [tokenAddr, wethAddr]);
      const out = amounts[1];
      const priceInWeth = parseFloat(ethers.formatUnits(out, 18));
      const wethPrice = await getEthPrice();
      if (!wethPrice) return 0;
      const usd = priceInWeth * wethPrice;
      if (debug_pairs) console.log(`[SUSHI SUCCESS] ${symbol} estimated at $${usd}`);
      return usd;
    } catch (e) {
      if (debug_pairs) console.warn(`[SUSHI FAIL] ${symbol}: ${e.code || e.message}`);
      return 0;
    }
  }

  const wethPrice = await getEthPrice();
  if (!wethPrice) return 0;

  const wethAmt = parseFloat(ethers.formatUnits(wethOut, 18));
  const usd = wethAmt * wethPrice;
  if (debug_pairs) console.log(`[SUCCESS] ${symbol} estimated at $${usd}`);
  return usd;
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
const provider = new ethers.JsonRpcProvider(process.env.ARB_RPC_URL);
const rawKey = process.env.PRIVATE_KEY ? process.env.PRIVATE_KEY.trim() : '';
const wallet = new ethers.Wallet(rawKey.startsWith('0x') ? rawKey : '0x' + rawKey, provider);
const walletAddress = getAddress(wallet.address);
const quoter = new ethers.Contract(QUOTER_V2_ADDRESS, UNISWAP_QUOTER_ABI, provider);

const SUSHI_ROUTER_ABI = [
  "function getAmountsOut(uint amountIn, address[] calldata path) external view returns (uint[] memory amounts)"
];
const sushiRouter = new ethers.Contract(
  '0x1b02da8cb0d097eb8d57a175b88c7d8b47997506',
  SUSHI_ROUTER_ABI,
  provider
);

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
const UNISWAP_ARBITRUM_ROUTER = '0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45';
const router = new ethers.Contract(
  getAddress(UNISWAP_ARBITRUM_ROUTER),
  routerAbi,
  wallet
);

const v3FactoryAbi = [
  'function getPool(address tokenA, address tokenB, uint24 fee) view returns (address)'
];
// Use a lowercase address so ethers.js applies the correct checksum
const v3FactoryAddress = getAddress('0x1f98431c8ad98523631ae4a59f267346ea31f984');
const v3Factory = new ethers.Contract(v3FactoryAddress, v3FactoryAbi, provider);
const FEE_TIERS = [500, 3000, 10000]; // 0.05%, 0.3%, 1%

const factoryAddress = getAddress('0x5C69bEe701ef814a2B6a3EDD4B1652CB9cc5aA6f');
const factory = new ethers.Contract(factoryAddress, factoryAbi, provider);

function getWethAddress() {
  return TOKENS.WETH;
}
const SLIPPAGE_BPS = BigInt(Math.round(SLIPPAGE * 10000));

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
      console.debug(`[APPROVE] ${symbol}`);
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
  const outAddr = TOKENS[outputToken.toUpperCase()];
  if (outputToken === 'ETH') outAddr = getWethAddress();
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

const logPath = path.join(__dirname, 'data', 'trade-log.json');

function appendLog(entry) {
  try { fs.mkdirSync(path.dirname(logPath), { recursive: true }); } catch {}
  let data = [];
  try { data = JSON.parse(fs.readFileSync(logPath)); } catch {}
  const ts = new Date().toLocaleString('en-US', { timeZone: 'America/Los_Angeles' });
  entry.timestamp = ts;
  data.push(entry);
  fs.writeFileSync(logPath, JSON.stringify(data, null, 2));

  let line = `[${localTime()}] ${entry.action}`;
  if (entry.token) line += ` ${entry.token}`;
  if (entry.qty) line += ` ${Number(entry.qty).toFixed(4)}`;
  if (entry.reason) line += ` (${entry.reason})`;
  console.log(line);
}

async function gasOkay() {
  const feeData = await withRetry(() => provider.getFeeData());
  const gasPrice = feeData.gasPrice || ethers.parseUnits('0', 'gwei');
  if (gasPrice > ethers.parseUnits(GAS_LIMIT_GWEI.toString(), 'gwei')) {
    const gwei = Number(ethers.formatUnits(gasPrice, 'gwei')).toFixed(1);
    logError(`Gas price ${gwei} gwei exceeds limit`);
    appendLog({ time: new Date().toISOString(), action: 'SKIP', reason: 'Gas high', gas: gwei });
    return false;
  }
  return true;
}

async function getPairAddress(tokenA, tokenB) {
  if (debug_pairs) {
    console.debug(`[PAIR] Searching pair for ${tokenA} ${tokenB}`);
  }
  for (const fee of FEE_TIERS) {
    try {
      const pool = await withRetry(() => v3Factory.getPool(tokenA, tokenB, fee));
      if (pool && pool !== ethers.ZeroAddress) {
        if (debug_pairs) {
          console.debug(`[PAIR] V3 pool ${fee} found for ${tokenA} ${tokenB}`);
        }
        return { address: pool, version: 'v3' };
      }
    } catch (err) {
      if (debug_pairs) {
        console.debug(`[PAIR] V3 search failed (${fee}): ${err.message}`);
      }
    }
  }
  try {
    const pair = await withRetry(() => factory.getPair(tokenA, tokenB));
    if (pair && pair !== ethers.ZeroAddress) {
      if (debug_pairs) {
        console.debug(`[PAIR] V2 pair found for ${tokenA} ${tokenB}`);
      }
      return { address: pair, version: 'v2' };
    }
    if (debug_pairs) {
      console.debug(`[PAIR] No pair found for ${tokenA} ${tokenB}`);
    }
  } catch (err) {
    if (debug_pairs) {
      console.debug(`[PAIR] V2 search failed: ${err.message}`);
    }
  }
  return { address: ethers.ZeroAddress, version: null };
}

// Quick sanity check before attempting a trade
async function validateTokenBeforeTrade(symbol, tokenAddress, wethAddress) {
  try {
    const pair = await factory.getPair(tokenAddress, wethAddress);
    if (pair === ethers.ZeroAddress) return false;
    return true;
  } catch {
    return false;
  }
}

async function validateLiquidity(tokenA, tokenB, symbol) {
  try {
    let { address: pairAddr, version } = await getPairAddress(tokenA, tokenB);
    if (pairAddr === ethers.ZeroAddress && TOKENS.USDC) {
      if (debug_pairs) {
        console.debug(`[PAIR] Retrying with USDC pair for ${symbol}`);
      }
      tokenA = TOKENS.USDC;
      ({ address: pairAddr, version } = await getPairAddress(tokenA, tokenB));
    }
    if (pairAddr === ethers.ZeroAddress) {
      console.debug(`\u274c No Uniswap pair found`);
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
      console.debug(`\u274c Pair has zero reserves`);
      return false;
    }
    const ethPrice = await getEthPrice();
    let liquidityUsd;
    if (tokenA.toLowerCase() === getWethAddress().toLowerCase()) {
      const wethAmt = Number(ethers.formatEther(reserve));
      liquidityUsd = ethPrice ? wethAmt * ethPrice : 0;
    } else if (TOKENS.USDC && tokenA.toLowerCase() === TOKENS.USDC.toLowerCase()) {
      liquidityUsd = Number(ethers.formatUnits(reserve, 6));
    } else {
      liquidityUsd = Number(ethers.formatEther(reserve));
    }
    if (liquidityUsd < 5) {
      console.debug(`[LIQUIDITY] Skipped ${symbol}: liquidity < $5`);
      return false;
    }
    return true;
  } catch (err) {
    console.debug(`\u274c Liquidity validation failed: ${err.message}`);
    return false;
  }
}


async function buy(token, opts = {}) {
  if (token && ['ETH', 'WETH'].includes(token.toUpperCase())) {
    return { success: false, reason: 'invalid-token' };
  }

  if (opts.dryRun || process.env.PAPER === 'true' || DRY_RUN) {
    console.debug(`[DRY] Simulating buy for ${token}`);
    return { success: true, simulated: true };
  }

  if (!await gasOkay()) return { success: false, reason: 'gas' };

  const tokenAddr = TOKENS[token.toUpperCase()];
  if (!tokenAddr) {
    console.debug('Token address is null, skipping trade.');
    return { success: false, reason: 'no-address' };
  }
  if (debug_pairs) {
    console.debug(`[ADDR] ${token} -> ${tokenAddr}`);
  }

  const wethBal = await getTokenBalance(getWethAddress(), walletAddress, 'WETH');
  if (wethBal < MIN_WETH_BAL) {
    console.debug(`🕒 [${localTime()}] ⚠️ Not enough WETH to trade`);
    return { success: false, reason: 'balance' };
  }

  const amountEth = wethBal * 0.15;
  const ethPrice = await getEthPrice();
  if (amountEth <= 0 || (ethPrice && amountEth * ethPrice < MIN_BUY_USD)) {
    console.debug(`🕒 [${localTime()}] ⚠️ Trade amount below $${MIN_BUY_USD}`);
    return { success: false, reason: 'amount' };
  }

  if (!await validateLiquidity(getWethAddress(), tokenAddr, token)) {
    appendLog({ time: new Date().toISOString(), action: 'SKIP', token, reason: 'liquidity' });
    return { success: false, reason: 'liquidity' };
  }

  const wethContract = new ethers.Contract(getWethAddress(), erc20Abi, wallet);
  const allowance = await wethContract.allowance(walletAddress, router.target);
  const amountParsed = parseAmount(amountEth, 'WETH');

  if (allowance === 0n) {
    console.debug(`🕒 [${localTime()}] 🟢 Approving WETH...`);
    const approvalTx = await wethContract.approve(router.target, amountParsed);
    await approvalTx.wait();
  }

  console.debug(`🕒 [${localTime()}] 🟢 Swapping WETH for ${token}...`);
  const before = await getTokenBalance(tokenAddr, walletAddress, token);
  const params = {
    tokenIn: getWethAddress(),
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
  console.debug(`🕒 [${localTime()}] ✅ TX confirmed: ${tx.hash}`);

  const after = await getTokenBalance(tokenAddr, walletAddress, token);
  const received = after - before;
  if (received <= 0) {
    console.debug(`🕒 [${localTime()}] ❌ Buy failed – no ${token} received`);
    return { success: false, reason: 'no-tokens' };
  }

  console.debug(`🕒 [${localTime()}] ✅ Bought ${received.toFixed(2)} ${token}`);
  const buyTime = new Date().toLocaleTimeString('en-US', { hour12: true, timeZone: 'America/Los_Angeles' });
  console.debug(`[BUY] ${token} for ${amountEth.toFixed(4)} ETH @ ${buyTime}`);
  return { success: true, tx: tx.hash, qty: received };
}

async function sell(amountToken, path, token, opts = {}) {
  if (token && ['ETH', 'WETH'].includes(token.toUpperCase())) {
    return { success: false, reason: 'invalid-token' };
  }
  console.debug(`🔥 Sell ${token} at ${localTime()}`);
  if (!await gasOkay()) return { success: false, reason: 'gas' };
  const tokenAddr = TOKENS[token.toUpperCase()];
  if (!tokenAddr) {
    console.debug("Token address is null, skipping trade.");
    return { success: false, reason: 'no-address' };
  }
  const swapPath = [tokenAddr, getWethAddress()];
  const bal = await getTokenBalance(tokenAddr, walletAddress, token);
  if (bal <= 0) {
    console.debug(`❌ No ${token} to sell`);
    return { success: false, reason: 'balance' };
  }
  if (amountToken > bal) {
    console.debug(`❌ Not enough ${token} to sell`);
    return { success: false, reason: 'balance' };
  }
  if (!await validateLiquidity(tokenAddr, getWethAddress(), token)) {
    appendLog({ time: new Date().toISOString(), action: 'SKIP', token, reason: 'liquidity' });
    return { success: false, reason: 'liquidity' };
  }

  const usdPrice = await getTokenUsdPrice(token);
  if (usdPrice && amountToken * usdPrice < MIN_TRADE_USD) {
    console.debug(`[SKIP] ${token} sell amount $${(amountToken * usdPrice).toFixed(2)} is below $${MIN_TRADE_USD} limit`);
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
      console.debug(`\u274c Not enough liquidity for ${token}`);
      appendLog({ time: new Date().toISOString(), action: 'SKIP', token, reason: 'liquidity' });
      return { success: false, reason: 'liquidity' };
    }
    const ethPrice = await getEthPrice();
    const wethOut = Number(ethers.formatEther(amounts[1]));
    const tradeValueUsd = wethOut * (ethPrice || 0);
    if (tradeValueUsd < MIN_TRADE_USD) {
      console.debug(`[SKIP] ${token} sell amount $${tradeValueUsd.toFixed(2)} is below $${MIN_TRADE_USD} limit`);
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
    console.debug(`\u274c Unable to get quote for ${token}: ${err.message}`);
    appendLog({ time: new Date().toISOString(), action: 'SKIP', token, reason: 'liquidity' });
    return { success: false, reason: 'liquidity' };
  }
  try {
    const amt = Number(amountToken).toFixed(6);
    console.debug(`[SELL] ${token} → WETH`);
    const gasEst = await withRetry(() => router.swapExactTokensForTokens.estimateGas(
      parseAmount(amt, token),
      minOut,
      swapPath,
      walletAddress,
      Math.floor(Date.now() / 1000) + 60 * 10
    ));
    console.debug(`[GAS] Estimated ${Number(gasEst)} units`);
    if (opts.dryRun || DRY_RUN) {
      console.debug('\u267B Dry run - transaction not sent');
      appendLog({ time: new Date().toISOString(), action: 'DRY-SELL', token, amountToken: amt });
      return { success: true, simulated: true };
    }
    const beforeWeth = await getTokenBalance(getWethAddress(), walletAddress, 'WETH');
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
    const afterWeth = await getTokenBalance(getWethAddress(), walletAddress, 'WETH');
    const earned = afterWeth - beforeWeth;
    console.debug(`✅ Sold ${token} for ${earned.toFixed(4)} WETH`);
    const sellNow = new Date().toLocaleTimeString('en-US', { hour12: true, timeZone: 'America/Los_Angeles' });
    console.debug(`[SELL] ${token} for ${earned.toFixed(4)} ETH @ ${sellNow}`);
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
    console.debug(`\u2718 No ${token} balance to sell`);
    return { success: false, reason: 'no_balance' };
  }

  const tokenPrice = await getTokenUsdPrice(token);
  const tradeValueUsd = balance * (tokenPrice || 0);

  if (tradeValueUsd < 10) {
    console.debug(`[SKIP] ${token} sell value is $${tradeValueUsd.toFixed(2)}, below $10 threshold`);
    return { success: false, reason: 'too_small' };
  }

  const receiveToken = SELL_DESTINATION;

  console.debug(`\u2022 Selling ${token} \u2192 ${receiveToken}`);
  console.debug(`\u2022 Token Balance: ${balance}`);
  console.debug(`\u2022 Token Price: $${tokenPrice}`);
  console.debug(`\u2022 Est. Value: $${tradeValueUsd.toFixed(2)}`);

  try {
    const tx = await swapExactTokenForToken({
      inputToken: token,
      outputToken: receiveToken,
      amountIn: balance,
      slippage: 0.005
    });
    if (tx) {
      console.debug(`\u2713 Swap TX sent: ${tx.hash}`);
      return { success: true, tx, qty: balance };
    }
  } catch (err) {
    console.debug(`\u2718 Swap failed`);
    return { success: false, reason: 'swap_failed' };
  }
  console.debug(`\u2718 Swap failed`);
  return { success: false, reason: 'swap_failed' };
}

async function getWethBalance() {
  return getTokenBalance(getWethAddress(), walletAddress, 'WETH');
}

async function autoWrapOrUnwrap() {
  const ethBalance = parseFloat(ethers.formatEther(await provider.getBalance(wallet.address)));
  const wethBalance = await getWethBalance();

  if (ethBalance < 0.003 && wethBalance > 0.01) {
    const WETH = new ethers.Contract(TOKENS.WETH, erc20Abi, wallet);
    const amount = parseAmount(0.01, 'WETH');
    const tx = await WETH.withdraw(amount);
    await tx.wait();
    console.debug(`✅ Unwrapped 0.01 WETH to ETH for gas`);
    return;
  }

  if (wethBalance < 0.01 && ethBalance > 0.01) {
    const WETH = new ethers.Contract(TOKENS.WETH, erc20Abi, wallet);
    const amount = parseAmount(0.01, 'ETH');
    const tx = await WETH.deposit({ value: amount });
    await tx.wait();
    console.debug(`✅ Wrapped 0.01 ETH to WETH for trading`);
    return;
  }
}

module.exports = {
  buy,
  sellToken,
  getWethBalance,
  getTokenBalance,
  autoWrapOrUnwrap,
  validateLiquidity,
  validateTokenBeforeTrade,
  getEthPrice,
  getTokenUsdPrice,
  TOKENS,
  refreshLocalTokenList
};
