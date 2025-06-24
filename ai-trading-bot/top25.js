// ✅ TOP25.js PATCHED FOR STABILITY, PRICE FEED, AND 50 TOKEN ENFORCEMENT

const axios = require('axios');
const { ethers } = require('ethers');
const { getAddress } = require('ethers');
const fs = require('fs');
const path = require('path');
const TOKENS = require('./tokens');
const { FALLBACK_TOKENS } = require('./tokens');
const trade = require('./trade');
const config = require('./config');
require('dotenv').config();

const TOKEN_LIST_URL = 'https://raw.githubusercontent.com/SmolData/tokenlists/main/arbitrum-tokenlist.json';

const FALLBACK_LIST = Object.entries(FALLBACK_TOKENS)
  .filter(([, addr]) => addr !== null)
  .map(([symbol, address]) => ({ symbol, address }));

const BASIC_FALLBACK = [
  { symbol: 'WETH', address: TOKENS.WETH },
  { symbol: 'USDC', address: TOKENS.USDC },
  { symbol: 'USDT', address: TOKENS.USDT },
  { symbol: 'DAI', address: TOKENS.DAI },
];

const provider = new ethers.JsonRpcProvider('https://arb1.arbitrum.io/rpc');
const CACHE_FILE = path.join(__dirname, '..', 'data', 'tokens.json');

let cachedTokens = [];
let lastFetched = 0;
let cacheLoaded = false;

function loadCache(forceRefresh = false) {
  try {
    if (forceRefresh) return;
    if (!fs.existsSync(CACHE_FILE)) return;
    const stat = fs.statSync(CACHE_FILE);
    const maxAge = (config.cacheHours || 24) * 60 * 60 * 1000;
    if (Date.now() - stat.mtimeMs > maxAge) return;
    const txt = fs.readFileSync(CACHE_FILE, 'utf8');
    const arr = JSON.parse(txt);
    if (Array.isArray(arr) && arr.length) {
      cachedTokens = arr;
      lastFetched = stat.mtimeMs;
      cacheLoaded = true;
      console.log(`♻ Loaded ${cachedTokens.length} cached tokens`);
    }
  } catch {}
}

function saveCache(tokens) {
  try {
    fs.mkdirSync(path.dirname(CACHE_FILE), { recursive: true });
    const count = config.tokenCount || 50;
    fs.writeFileSync(CACHE_FILE, JSON.stringify(tokens.slice(0, count), null, 2));
  } catch (err) {
    console.warn(`⚠️ Failed to save cache: ${err.message}`);
  }
}

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
      console.log(`✅ Loaded ${sym}`);
      list.push({ symbol: sym, address: t.address });
    }
    return list;
  } catch (err) {
    return [...FALLBACK_LIST];
  }
}

async function fetchEthPrice() {
  try {
    const feedAddress = '0x639Fe6ab55C921f74e7fac1ee960C0B6293ba612'; // Chainlink ETH/USD
    const abi = ['function latestAnswer() view returns (int256)'];
    const feed = new ethers.Contract(feedAddress, abi, provider);
    const price = await feed.latestAnswer();
    return Number(price) / 1e8;
  } catch (err) {
    console.error(`⚠️ ETH price fetch failed: ${err.message}`);
    return 0;
  }
}

async function validateToken(token, ethPrice) {
  let address = token.address || TOKENS[token.symbol.toUpperCase()] || await TOKENS.getTokenAddress?.(token.symbol);
  if (!address) return null;

  let checksummed;
  try {
    checksummed = getAddress(address);
  } catch {
    console.warn(`❌ Invalid address for ${token.symbol.toUpperCase()}: ${address}`);
    return null;
  }

  const weth = TOKENS.WETH || await TOKENS.getTokenAddress('WETH');
  if (!weth) return null;

  try {
    const hasLiquidity = await trade.validateLiquidity(weth, checksummed, token.symbol);
    if (!hasLiquidity) return null;

    const price = await trade.getTokenUsdPrice(token.symbol);
    if (!price) return null;

    TOKENS[token.symbol.toUpperCase()] = checksummed;
    console.log(`✅ Validated ${token.symbol.toUpperCase()}`);
    return { symbol: token.symbol.toUpperCase(), address: checksummed, score: price };
  } catch (err) {
    console.warn(`⚠️ Validation failed for ${token.symbol}: ${err.message}`);
    return null;
  }
}

async function getValidTokens(forceRefresh = false) {
  loadCache(forceRefresh);
  if (forceRefresh) console.log('🔁 Forced refresh requested');
  const now = Date.now();
  const maxAge = (config.cacheHours || 24) * 60 * 60 * 1000;
  if (!forceRefresh && cachedTokens.length && now - lastFetched < maxAge && cacheLoaded) {
    console.log(`♻ Using cached token list (${cachedTokens.length})`);
    return [...cachedTokens];
  }

  try {
    console.log('🔄 Loading token list...');
    const ethPrice = await fetchEthPrice();
    const tokenList = await fetchTokenList();
    const valid = [];
    for (const token of tokenList) {
      const res = await validateToken(token, ethPrice);
      if (res) valid.push(res);
    }

    console.log(`✅ Validated ${valid.length} of ${tokenList.length} tokens`);

    valid.sort((a, b) => b.score - a.score);
    const count = config.tokenCount || 50;
    if (valid.length >= count) {
      cachedTokens = valid.slice(0, count);
    } else {
      console.log('❌ Fallback triggered: using static token list');
      const staticList = TOKENS.getValidTokens?.() || FALLBACK_LIST;
      cachedTokens = staticList.map(t => ({ symbol: t.symbol, address: t.address, score: 0 }));
    }

    lastFetched = Date.now();
    saveCache(cachedTokens);
    console.log('✅ Using new token list');
    return [...cachedTokens];
  } catch (err) {
    console.warn(`❌ Token fetch failed: ${err.message}`);
    const staticList = TOKENS.getValidTokens?.() || FALLBACK_LIST;
    cachedTokens = staticList.map(t => ({ symbol: t.symbol, address: t.address, score: 0 }));
    lastFetched = Date.now();
    saveCache(cachedTokens);
    console.log('✅ Using fallback token list');
    return [...cachedTokens];
  }
}

function getTop25TradableTokens(forceRefresh = false) {
  return getValidTokens(forceRefresh).then(list => {
    const count = config.tokenCount || 50;
    return list.slice(0, count).map(t => t.symbol);
  });
}

module.exports = { getValidTokens, getTop25TradableTokens };
