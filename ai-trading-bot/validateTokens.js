require('dotenv').config();
const { ethers } = require('ethers');
const TOKENS = require('./tokens');
const { getValidTokens } = require('./top25');

// Connect to Arbitrum
const provider = new ethers.JsonRpcProvider(process.env.ARB_RPC_URL);

// Chainlink price feeds for Arbitrum
async function getTokenUsdPrice(symbol) {
  const feeds = {
    ETH:  '0x639Fe6ab55C921f74e7fac1ee960C0B6293ba612',
    USDC: '0x6ce185860a4963106506C203335A2910413708e9',
    USDT: '0x3f3f5dF88dC9F13eac63DF89EC16ef6e7E25DdE7',
    DAI:  '0x678df3415fc31947dA4324eC63212874be5a82f8',
    ARB:  '0xb2A824043730FE05F3DA2efafa1cbBE83fa548D6'
  };
  const addr = feeds[symbol.toUpperCase()];
  if (!addr) return null;
  const feed = new ethers.Contract(addr, ['function latestAnswer() view returns (int256)'], provider);
  const raw = await feed.latestAnswer();
  return Number(raw) / 1e8;
}

// Validate token by address checksum, Chainlink price and V3 pool existence
async function validateToken(symbol, address, weth) {
  let checksummed;
  try {
    checksummed = ethers.getAddress(address);
  } catch {
    console.log(`❌ Invalid address: ${symbol}`);
    return false;
  }

  const price = await getTokenUsdPrice(symbol);
  if (!price || price <= 0) {
    console.log(`❌ No Chainlink price: ${symbol}`);
    return false;
  }

  const factory = new ethers.Contract(
    '0x1f98431c8ad98523631ae4a59f267346ea31f984',
    ['function getPool(address,address,uint24) view returns (address)'],
    provider
  );

  const fees = [500, 3000, 10000];
  for (const fee of fees) {
    try {
      const pool = await factory.getPool(weth, checksummed, fee);
      if (pool && pool !== ethers.ZeroAddress) {
        console.log(`✅ ${symbol}: price $${price}, V3 pool found`);
        return true;
      }
    } catch {}
  }

  console.log(`❌ No V3 pool for ${symbol}`);
  return false;
}

async function runTokenValidation(tokenList, wethAddress) {
  let success = 0;
  for (const { symbol, address } of tokenList) {
    const ok = await validateToken(symbol, address, wethAddress);
    if (ok) {
      console.log(`✅ ${symbol} passed`);
      success++;
    } else {
      console.log(`❌ ${symbol} failed`);
    }
  }
  console.log(`\nResult: ${success}/${tokenList.length} tokens validated.`);
}

async function main() {
  const tokens = await getValidTokens(process.argv.includes('--force-refresh'));
  await runTokenValidation(tokens, TOKENS.WETH);
}

main().catch(err => console.error(err));
