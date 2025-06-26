const fs = require('fs');
const path = require('path');
const { ethers } = require('ethers');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const provider = new ethers.JsonRpcProvider(process.env.ARB_RPC_URL || 'https://arb1.arbitrum.io/rpc');
const tokensPath = path.join(__dirname, '../data/arbitrum.tokenlist.json');
const feedsPath = path.join(__dirname, '../data/feeds.json');
const rawFile = path.join(__dirname, 'rawTokens.json');
const tokensFile = path.join(__dirname, 'tokens.json');

const feedAbi = ['function latestAnswer() view returns (int256)'];

function loadTokens() {
  const data = JSON.parse(fs.readFileSync(tokensPath));
  const list = data.tokens || [];
  return Array.isArray(list) ? list.map(t => ({ symbol: t.symbol, address: t.address })) : [];
}

function loadFeeds() {
  const data = JSON.parse(fs.readFileSync(feedsPath));
  const map = {};
  const entries = data.entries || [];
  for (const e of entries) {
    const [sym] = String(e.pair || '').split('/');
    if (sym && ethers.isAddress(e.feed)) {
      map[sym.toUpperCase()] = e.feed;
    }
  }
  return map;
}

async function validate() {
  const candidates = loadTokens();
  const feeds = loadFeeds();

  const raw = [];
  const valid = [];

  for (const t of candidates) {
    const symbol = String(t.symbol || '').trim().toUpperCase();
    if (!symbol || !ethers.isAddress(t.address)) continue;
    const feed = feeds[symbol];
    if (!feed) continue;

    raw.push({ symbol, address: t.address, feed });
    try {
      const agg = new ethers.Contract(feed, feedAbi, provider);
      const price = await agg.latestAnswer();
      if (price > 0n) {
        valid.push({ symbol, address: t.address, feed });
        console.log(`Validated ${symbol}`);
      }
    } catch {}
  }

  fs.writeFileSync(rawFile, JSON.stringify(raw, null, 2));
  fs.writeFileSync(tokensFile, JSON.stringify(valid, null, 2));

  return valid;
}

if (require.main === module) {
  validate().catch(err => console.error(err));
}

module.exports = validate;
