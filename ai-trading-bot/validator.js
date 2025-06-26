const fs = require('fs');
const path = require('path');
const axios = require('axios');
const { ethers } = require('ethers');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const provider = new ethers.JsonRpcProvider(process.env.ARB_RPC_URL || 'https://arb1.arbitrum.io/rpc');
const TOKENS_URL = 'https://api.1inch.io/v5.0/42161/tokens';
const FEEDS_URL = 'https://cl-docs-addresses.web.app/feeds-arbitrum-mainnet.json';

const feedAbi = [
  'function latestAnswer() view returns (int256)',
  'function decimals() view returns (uint8)'
];

async function fetchTokenCandidates() {
  try {
    const { data } = await axios.get(TOKENS_URL);
    const list = Object.values(data.tokens).slice(0, 100);
    return list.map(t => ({ symbol: t.symbol, address: t.address }));
  } catch (err) {
    console.error('Failed to fetch token list:', err.message);
    return [];
  }
}

async function fetchFeeds() {
  try {
    const { data } = await axios.get(FEEDS_URL);
    // data assumed to be {entries: [{pair, feed}]}
    const mapping = {};
    (data.entries || []).forEach(e => {
      const [sym] = e.pair.split('/');
      mapping[sym.trim().toUpperCase()] = e.feed;
    });
    return mapping;
  } catch (err) {
    console.error('Failed to fetch chainlink feeds:', err.message);
    return {};
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
