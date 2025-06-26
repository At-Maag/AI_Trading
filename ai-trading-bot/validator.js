const fs = require('fs');
const path = require('path');
let axios;
try {
  axios = require('axios');
} catch {
  axios = {
    get: async url => {
      const res = await fetch(url);
      const data = await res.json();
      return { data };
    }
  };
}
const { ethers } = require('ethers');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const provider = new ethers.JsonRpcProvider(process.env.ARB_RPC_URL || 'https://arb1.arbitrum.io/rpc');
const TOKENS_URL =
  'https://tokens.coingecko.com/arbitrum/all.json';
const FEEDS_URL =
  'https://raw.githubusercontent.com/dataalways/chainlink-feeds/main/arbitrum.json';

const feedAbi = [
  'function latestAnswer() view returns (int256)',
  'function decimals() view returns (uint8)'
];

const fallbackTokens = [
  {
    symbol: 'WETH',
    address: '0x82af49447d8a07e3bd95bd0d56f35241523fbab1',
    feed: '0x639Fe6ab55C921f74e7fac1ee960C0B6293ba612'
  },
  {
    symbol: 'USDC',
    address: '0xaf88d065e77c8cc2239327c5edb3a432268e5831',
    feed: '0x6ce185860a4963106506C203335A2910413708e9'
  },
  {
    symbol: 'USDT',
    address: '0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9',
    feed: '0x3f3f5dF88dC9F13eac63DF89EC16ef6e7E25DdE7'
  },
  {
    symbol: 'DAI',
    address: '0xda10009cbd5d07dd0cecc66161fc93d7c9000da1',
    feed: '0x678df3415fc31947dA4324eC63212874be5a82f8'
  }
];

async function fetchTokenCandidates() {
  try {
    const { data } = await axios.get(TOKENS_URL);
    const list = data.tokens || data;
    const arr = Array.isArray(list)
      ? list.slice(0, 100)
      : Object.values(list).slice(0, 100);
    return arr.map(t => ({ symbol: t.symbol, address: t.address }));
  } catch (err) {
    console.error('Failed to fetch token list:', err.message);
    try {
      const local = JSON.parse(
        fs.readFileSync(path.join(__dirname, 'rawTokens.json'))
      );
      if (Array.isArray(local) && local.length) return local;
    } catch {}
    console.warn('Using fallback tokens');
    return fallbackTokens;
  }
}

async function fetchFeeds() {
  try {
    const { data } = await axios.get(FEEDS_URL);
    const entries =
      data.entries || data.feeds || data.data || data || [];
    const mapping = {};
    (Array.isArray(entries) ? entries : Object.values(entries)).forEach(e => {
      const pair = e.pair || e.name || e.symbol || '';
      const addr =
        e.feed || e.proxy || e.address || e.proxyAddress || e.aggregator;
      const [sym] = pair.split('/');
      if (sym && ethers.isAddress(addr)) {
        mapping[sym.trim().toUpperCase()] = addr;
      }
    });
    return Object.keys(mapping).length ? mapping : {};
  } catch (err) {
    console.error('Failed to fetch chainlink feeds:', err.message);
    const local = {};
    fallbackTokens.forEach(t => {
      if (t.feed) local[t.symbol.toUpperCase()] = t.feed;
    });
    console.warn('Using fallback feeds');
    return local;
  }
}

async function validate() {
  const rawFile = path.join(__dirname, 'rawTokens.json');
  const tokensFile = path.join(__dirname, 'tokens.json');
  const candidates = await fetchTokenCandidates();
  const feeds = await fetchFeeds();

  const raw = [];
  const valid = [];

  for (const t of candidates) {
    const symbol = t.symbol ? t.symbol.trim().toUpperCase() : '';
    const addr = t.address;
    const feed = feeds[symbol];
    if (!symbol) {
      console.log(`⚠️  ${t.address} skipped: empty symbol`);
      continue;
    }
    if (!ethers.isAddress(addr)) {
      console.log(`⚠️  ${symbol} skipped: invalid address`);
      continue;
    }
    if (!feed || !ethers.isAddress(feed)) {
      console.log(`⚠️  ${symbol} skipped: no chainlink feed`);
      continue;
    }

    raw.push({ symbol, address: addr, feed });
    try {
      const aggregator = new ethers.Contract(feed, feedAbi, provider);
      const price = await aggregator.latestAnswer();
      if (price <= 0n) {
        console.log(`⚠️  ${symbol} skipped: feed returned zero`);
        continue;
      }
      valid.push({ symbol, address: addr, feed });
      console.log(`✅ ${symbol}`);
    } catch (err) {
      console.log(`⚠️  ${symbol} skipped: ${err.message}`);
    }
  }

  fs.writeFileSync(rawFile, JSON.stringify(raw, null, 2));
  fs.writeFileSync(tokensFile, JSON.stringify(valid, null, 2));

  console.log('\nSummary');
  console.table(valid);
}

if (require.main === module) {
  validate().catch(err => console.error(err));
}

module.exports = validate;
