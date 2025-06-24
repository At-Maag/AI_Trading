const axios = require('axios');
const { ethers } = require('ethers');
const { getAddress } = require('ethers');
const TOKENS = require('./tokens');
const trade = require('./trade');
require('dotenv').config();

const TOKEN_LIST_URL =
  'https://tokens.coingecko.com/arbitrum/all.json';

// Provider for on-chain lookups on Arbitrum
const provider = new ethers.JsonRpcProvider('https://arb1.arbitrum.io/rpc');


let cachedTokens = [];
let lastFetched = 0;

async function fetchTokenList() {
  const { data } = await axios.get(TOKEN_LIST_URL, { timeout: 15000 });
  if (!data || !Array.isArray(data.tokens)) return [];
  return data.tokens.slice(0, 300).map(t => ({
    symbol: t.symbol,
    address: t.address
  }));
}

async function fetchEthPrice() {
  const { data } = await axios.get(
    'https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd',
    { timeout: 10000 }
  );
  return data.ethereum.usd;
}

async function validateToken(token, ethPrice) {
  let address = token.address;
  if (!address) {
    address = TOKENS[token.symbol.toUpperCase()];
  }
  if (!address && TOKENS.getTokenAddress) {
    address = await TOKENS.getTokenAddress(token.symbol);
  }
  if (!address) return null;

  let checksummed;
  try {
    checksummed = getAddress(address);
  } catch {
    console.warn(`\u274c Invalid address for ${token.symbol.toUpperCase()}: ${address}`);
    return null;
  }

  const weth = TOKENS.WETH || (await TOKENS.getTokenAddress('WETH'));
  if (!weth) return null;

  const hasLiquidity = await trade.validateLiquidity(weth, checksummed, token.symbol);
  if (!hasLiquidity) return null;

  const price = await trade.getTokenUsdPrice(token.symbol);
  if (!price) return null;

  TOKENS[token.symbol.toUpperCase()] = checksummed;
  console.log(`\u2705 Validated ${token.symbol.toUpperCase()}`);
  return { symbol: token.symbol.toUpperCase(), score: price };
}

async function getValidTokens() {
  const now = Date.now();
  if (cachedTokens.length && now - lastFetched < 24 * 60 * 60 * 1000) {
    console.log(`\u267B Using cached token list (${cachedTokens.length})`);
    return [...cachedTokens];
  }
  try {
    console.log('\uD83D\uDD04 Loading token list...');
    const ethPrice = await fetchEthPrice();
    const tokenList = await fetchTokenList();
    const valid = [];
    for (const token of tokenList) {
      const res = await validateToken(token, ethPrice);
      if (res) valid.push(res);
    }

    valid.sort((a, b) => b.score - a.score);

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
  return getValidTokens().then(list => list.slice(0, 25).map(t => t.symbol));
}

module.exports = { getValidTokens, getTop25TradableTokens };
