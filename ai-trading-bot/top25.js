const axios = require('axios');
const { ethers } = require('ethers');
const { getAddress } = require('ethers');
const fs = require('fs');
const path = require('path');
const TOKENS = require('./tokens');
const { FALLBACK_TOKENS } = require('./tokens');
const trade = require('./trade');
require('dotenv').config();

const TOKEN_LIST_URL =
  'https://raw.githubusercontent.com/SmolData/tokenlists/main/arbitrum-tokenlist.json';

const FALLBACK_LIST = Object.entries(FALLBACK_TOKENS)
  .filter(([, addr]) => addr !== null)
  .map(([symbol, address]) => ({
    symbol,
    address
  }));

// Minimal token set used when network calls fail completely
const BASIC_FALLBACK = [
  { symbol: 'WETH', address: TOKENS.WETH },
  { symbol: 'USDC', address: TOKENS.USDC },
  { symbol: 'USDT', address: TOKENS.USDT },
  { symbol: 'DAI', address: TOKENS.DAI },
  { symbol: 'WBTC', address: TOKENS.WBTC }
];

// Provider for on-chain lookups on Arbitrum
const provider = new ethers.JsonRpcProvider('https://arb1.arbitrum.io/rpc');

const CACHE_FILE = path.join(__dirname, '..', 'data', 'tokens.json');

let cachedTokens = [];
let lastFetched = 0;

function loadCache() {
  try {
    const txt = fs.readFileSync(CACHE_FILE, 'utf8');
    const arr = JSON.parse(txt);
    if (Array.isArray(arr) && arr.length) {
      cachedTokens = arr;
      lastFetched = Date.now();
      console.log(`\u267B Loaded ${cachedTokens.length} cached tokens`);
    }
  } catch {}
}

function saveCache(tokens) {
  try {
    fs.mkdirSync(path.dirname(CACHE_FILE), { recursive: true });
    fs.writeFileSync(CACHE_FILE, JSON.stringify(tokens.slice(0, 25), null, 2));
  } catch (err) {
    console.warn(`\u26A0\uFE0F Failed to save cache: ${err.message}`);
  }
}

loadCache();

async function fetchTokenList() {
  try {
    const { data } = await axios.get(TOKEN_LIST_URL, { timeout: 15000 });
    if (!data || !Array.isArray(data.tokens)) return [...FALLBACK_LIST];
    const list = [];
    const seen = new Set();
    for (const t of data.tokens.slice(0, 250)) {
      if (!t.symbol || !t.address) continue;
      const sym = t.symbol.toUpperCase();
      if (seen.has(sym)) continue;
      seen.add(sym);
      console.log(`\u2705 Loaded ${sym}`);
      list.push({ symbol: sym, address: t.address });
    }
    return list;
  } catch (err) {
    // Silently fall back to the built-in list
    return [...FALLBACK_LIST];
  }
}

async function fetchEthPrice() {
  try {
    const { data } = await axios.get(
      'https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd',
      { timeout: 10000 }
    );
    return data.ethereum.usd;
  } catch (err) {
    console.error(`\u26A0\uFE0F ETH price fetch failed: ${err.message}`);
    return 0;
  }
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

    console.log(
      `\u2705 Validated ${valid.length} of ${tokenList.length} tokens (minimum $5 liquidity)`
    );

    valid.sort((a, b) => b.score - a.score);
    console.log(`\u2705 Using top 25 tokens for trading`);

    if (valid.length) {
      cachedTokens = valid;
      lastFetched = Date.now();
      saveCache(cachedTokens);
    } else {
      // Provide minimal set when validations fail entirely
      cachedTokens = BASIC_FALLBACK.map(t => ({ symbol: t.symbol, score: 0 }));
      lastFetched = Date.now();
      saveCache(cachedTokens);
    }
    return [...cachedTokens];
  } catch (err) {
    // Silently return cached results on failure
    return [...cachedTokens];
  }
}

function getTop25TradableTokens() {
  return getValidTokens().then(list => list.slice(0, 25).map(t => t.symbol));
}

module.exports = { getValidTokens, getTop25TradableTokens };
