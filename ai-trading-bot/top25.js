const axios = require('axios');
const { ethers } = require('ethers');
const { getAddress } = require('ethers');
const TOKENS = require('./tokens');
require('dotenv').config();

// Provider for on-chain lookups on Arbitrum
const provider = new ethers.JsonRpcProvider('https://arb1.arbitrum.io/rpc');

const factoryAbi = [
  'function getPair(address tokenA, address tokenB) external view returns (address pair)'
];

const pairAbi = [
  'function getReserves() external view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)',
  'function token0() external view returns (address)',
  'function token1() external view returns (address)'
];

const factoryAddress = getAddress('0x5C69bEe701ef814a2B6a3EDD4B1652CB9cc5aA6f');
const factory = new ethers.Contract(factoryAddress, factoryAbi, provider);

let cachedTokens = [];
let lastFetched = 0;

async function fetchEthPrice() {
  const { data } = await axios.get(
    'https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd',
    { timeout: 10000 }
  );
  return data.ethereum.usd;
}

async function validateToken(token, ethPrice) {
  let address = token.platforms && token.platforms.ethereum;
  if (!address) {
    // Fall back to a statically configured address if available
    address = TOKENS[token.symbol.toUpperCase()];
  }
  if (!address && TOKENS.getTokenAddress) {
    address = await TOKENS.getTokenAddress(token.symbol);
  }
  if (!address) {
    try {
      // Attempt ENS lookup as a last resort
      address = await provider.resolveName(`${token.symbol}.eth`);
    } catch {}
  }
  if (!address) {
    console.warn(`\u274c Missing address for ${token.symbol.toUpperCase()}`);
    return null;
  }

  let checksummed;
  try {
    checksummed = getAddress(address);
  } catch {
    console.warn(`\u274c Invalid address for ${token.symbol.toUpperCase()}: ${address}`);
    return null;
  }

  // \u2705 Skip Uniswap V2 pair check on Arbitrum (V2 not used here)
  TOKENS[token.symbol.toUpperCase()] = checksummed;
  console.log(`\u2705 Validated ${token.symbol.toUpperCase()}`);
  return token.symbol.toUpperCase();
}

async function getValidTokens() {
  const now = Date.now();
  if (cachedTokens.length && now - lastFetched < 24 * 60 * 60 * 1000) {
    console.log(`\u267B Using cached token list (${cachedTokens.length})`);
    return [...cachedTokens];
  }
  try {
    console.log('\uD83D\uDD04 Validating static token list...');
    const ethPrice = await fetchEthPrice();
    const tokenSymbols = Object.keys(TOKENS).filter(s => s !== 'WETH');
    const valid = [];
    for (const symbol of tokenSymbols) {
      const res = await validateToken({ symbol }, ethPrice);
      if (res && !valid.includes(res)) {
        valid.push(res);
      }
      if (valid.length >= 25) break;
    }

    if (valid.length) {
      cachedTokens = valid;
      lastFetched = Date.now();
    }
    console.log(`\u2705 ${valid.length} tokens validated`);
    return [...cachedTokens];
  } catch (err) {
    console.error(`\u274c Token validation failed: ${err.message}`);
    return [...cachedTokens];
  }
}

function getTop25TradableTokens() {
  return getValidTokens();
}

module.exports = { getValidTokens, getTop25TradableTokens };
