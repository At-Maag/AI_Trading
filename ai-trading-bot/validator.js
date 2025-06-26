const fs = require('fs');
const path = require('path');
const { ethers } = require('ethers');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const provider = new ethers.JsonRpcProvider(process.env.ARB_RPC_URL || 'https://arb1.arbitrum.io/rpc');
const tokensPath = path.join(__dirname, '../data/arbitrum.tokenlist.json');
const feedsPath = path.join(__dirname, '../data/feeds.json');

const feedAbi = [
  'function latestAnswer() view returns (int256)',
  'function decimals() view returns (uint8)'
];


function loadTokenCandidates() {
  const data = JSON.parse(fs.readFileSync(tokensPath));
  const list = data.tokens || data;
  const arr = Array.isArray(list) ? list : Object.values(list);
  return arr.map(t => ({ symbol: t.symbol, address: t.address }));
}

function loadFeeds() {
  const data = JSON.parse(fs.readFileSync(feedsPath));
  const entries = data.entries || data.feeds || data.data || data || [];
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
  return mapping;
}

async function validate() {
  const rawFile = path.join(__dirname, 'rawTokens.json');
  const tokensFile = path.join(__dirname, 'tokens.json');
  const candidates = loadTokenCandidates();
  const feeds = loadFeeds();

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
