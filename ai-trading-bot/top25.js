const axios = require('axios');
const { ethers } = require('ethers');
const { getAddress } = require('ethers/lib/utils');
const TOKENS = require('./tokens');
require('dotenv').config();

// Provider for on-chain lookups
const provider = new ethers.InfuraProvider('mainnet', process.env.INFURA_API_KEY);

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

async function fetchTopTokens() {
  const url =
    'https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=25&platform=ethereum';
  const { data } = await axios.get(url, { timeout: 10000 });
  return data;
}

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
    try {
      address = await provider.resolveName(`${token.symbol}.eth`);
    } catch {}
    if (!address) {
      console.warn(`\u274c Missing address for ${token.symbol.toUpperCase()}`);
      return null;
    }
  }
  let checksummed;
  try {
    checksummed = getAddress(address);
  } catch {
    console.warn(`\u274c Invalid address for ${token.symbol.toUpperCase()}: ${address}`);
    return null;
  }

  const pairAddr = await factory.getPair(TOKENS.WETH, checksummed);
  if (pairAddr === ethers.ZeroAddress) {
    console.warn(`\u274c No Uniswap V2 pair for ${token.symbol.toUpperCase()}`);
    return null;
  }

  const pair = new ethers.Contract(pairAddr, pairAbi, provider);
  let reserves;
  try {
    reserves = await pair.getReserves();
  } catch {
    console.warn(`\u274c Cannot read reserves for ${token.symbol.toUpperCase()}`);
    return null;
  }
  const token0 = await pair.token0();
  const wethReserve = token0.toLowerCase() === TOKENS.WETH.toLowerCase() ? reserves[0] : reserves[1];
  const wethAmt = Number(ethers.formatEther(wethReserve));
  if (wethAmt * ethPrice < 500) {
    console.warn(`\u274c Liquidity <$500 for ${token.symbol.toUpperCase()}`);
    return null;
  }

  TOKENS[token.symbol.toUpperCase()] = checksummed;
  console.log(`\u2705 Added ${token.symbol.toUpperCase()}`);
  return token.symbol.toUpperCase();
}

async function getValidTokens() {
  const now = Date.now();
  if (cachedTokens.length && now - lastFetched < 24 * 60 * 60 * 1000) {
    console.log(`\u267B Using cached token list (${cachedTokens.length})`);
    return [...cachedTokens];
  }
  try {
    console.log('\uD83D\uDD04 Fetching tokens from CoinGecko...');
    const [tokens, ethPrice] = await Promise.all([fetchTopTokens(), fetchEthPrice()]);
    const valid = [];
    for (const t of tokens) {
      const res = await validateToken(t, ethPrice);
      if (res) {
        valid.push(res);
      }
    }
    if (valid.length) {
      cachedTokens = valid;
      lastFetched = Date.now();
    }
    console.log(`\u2705 ${valid.length} tokens validated`);
    return valid.length ? [...valid] : [...cachedTokens];
  } catch (err) {
    console.error(`\u274c Token fetch failed: ${err.message}`);
    return [...cachedTokens];
  }
}

module.exports = { getValidTokens };
