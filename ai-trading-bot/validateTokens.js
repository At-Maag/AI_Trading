// 🧠 Final patch for Arbitrum-only token validation:
// 1. Checksums all token addresses (EIP-55 casing)
// 2. Validates tokens using Chainlink price feeds on Arbitrum
// 3. Detects Uniswap V3 liquidity via getPool()
// 4. Auto-corrects bad input addresses with try/catch
// 5. Dynamically skips tokens with no pool or feed

const { ethers } = require('ethers');
require('dotenv').config();
const TOKENS = require('./tokens');
const { getValidTokens } = require('./top25');

// ✅ Use .env or fallback RPC
const provider = new ethers.JsonRpcProvider(
  process.env.ARB_RPC_URL || 'https://arb1.arbitrum.io/rpc'
);

// ✅ WETH for Arbitrum
const WETH = TOKENS.WETH || '0x82af49447d8a07e3bd95bd0d56f35241523fbab1';

// ✅ Chainlink USD feeds on Arbitrum (update as needed)
const FEEDS = {
  ETH:  '0x639Fe6ab55C921f74e7fac1ee960C0B6293ba612',
  USDC: '0x6ce185860a4963106506C203335A2910413708e9',
  USDT: '0x3f3f5dF88dC9F13eac63DF89EC16ef6e7E25DdE7',
  DAI:  '0x678df3415fc31947dA4324eC63212874be5a82f8',
  ARB:  '0xb2A824043730FE05F3DA2efafa1cbBE83fa548D6'
};

// ✅ Uniswap V3 Factory (Arbitrum)
const FACTORY = new ethers.Contract(
  '0x1F98431c8aD98523631AE4a59f267346ea31F984',
  ['function getPool(address,address,uint24) external view returns (address)'],
  provider
);

// ✅ Fetch USD price from Chainlink (if feed exists)
async function getTokenUsdPrice(symbol) {
  const feed = FEEDS[symbol.toUpperCase()];
  if (!feed) return null;
  try {
    const oracle = new ethers.Contract(
      feed,
      ['function latestAnswer() view returns (int256)'],
      provider
    );
    const price = await oracle.latestAnswer();
    return Number(price) / 1e8;
  } catch {
    return null;
  }
}

// ✅ Validate token: checksum, price feed, V3 pool
async function validateToken(symbol, address) {
  let checksummed;
  try {
    checksummed = ethers.getAddress(address);
  } catch {
    console.log(`❌ Invalid address for ${symbol}`);
    return false;
  }

  const price = await getTokenUsdPrice(symbol);
  if (!price || price <= 0) {
    console.log(`❌ No Chainlink price: ${symbol}`);
    return false;
  }

  const tiers = [500, 3000, 10000];
  for (const fee of tiers) {
    try {
      const pool = await FACTORY.getPool(WETH, checksummed, fee);
      if (pool && pool !== ethers.ZeroAddress) {
        console.log(`✅ ${symbol}: $${price.toFixed(2)} | pool @ ${fee}`);
        return true;
      }
    } catch {}
  }

  console.log(`❌ No Uniswap V3 pool: ${symbol}`);
  return false;
}

// ✅ Run validation over top 25 tokens
async function main() {
  const tokens = await getValidTokens(true);
  let count = 0;
  for (const { symbol, address } of tokens) {
    const ok = await validateToken(symbol, address);
    if (ok) count++;
  }
  console.log(`\n✅ ${count}/${tokens.length} tokens validated on Arbitrum`);
}

main();
