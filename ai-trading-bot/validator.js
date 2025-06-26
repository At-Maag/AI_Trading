const fs = require('fs');
const path = require('path');
const { ethers } = require('ethers');
require('dotenv').config();

const tokenListPath = path.join(__dirname, 'data', 'arbitrum.tokenlist.json');
const feedsPath = path.join(__dirname, 'data', 'feeds.json');
const tokensFile = path.join(__dirname, 'tokens.json');
const rawTokensFile = path.join(__dirname, 'rawTokens.json');

function loadTokens() {
  const data = JSON.parse(fs.readFileSync(tokenListPath));
  const list = data.tokens || [];
  return list.map(t => ({ symbol: String(t.symbol).toUpperCase(), address: t.address }));
}

function loadFeeds() {
  const data = JSON.parse(fs.readFileSync(feedsPath));
  const entries = data.entries || [];
  const map = {};
  for (const e of entries) {
    const [sym] = String(e.pair || '').split('/');
    if (sym && ethers.isAddress(e.feed)) {
      map[sym.toUpperCase()] = e.feed;
    }
  }
  return map;
}

async function validate() {
  const provider = new ethers.JsonRpcProvider(process.env.ARB_RPC_URL);
  const abi = ['function latestAnswer() view returns (int256)'];

  const tokens = loadTokens();
  const feeds = loadFeeds();
  const valid = [];
  const raw = [];

  for (const t of tokens) {
    if (!ethers.isAddress(t.address)) continue;
    const feed = feeds[t.symbol];
    const entry = { symbol: t.symbol, address: t.address };
    if (feed) entry.feed = feed;

    if (!feed) {
      entry.reason = 'no feed';
      console.log(`\u274c ${t.symbol} \u2192 no feed`);
      raw.push(entry);
      continue;
    }

    const aggregator = new ethers.Contract(feed, abi, provider);
    let price;
    try {
      price = await aggregator.latestAnswer();
    } catch (err) {
      entry.reason = err.message || 'feed error';
      console.log(`\u274c ${t.symbol} \u2192 ${entry.reason}`);
      raw.push(entry);
      continue;
    }

    const num = Number(price);
    if (!num) {
      entry.reason = 'price=0';
      entry.price = price ? price.toString() : '0';
      console.log(`\u274c ${t.symbol} \u2192 price=0`);
      raw.push(entry);
      continue;
    }

    entry.price = price.toString();
    valid.push({ symbol: t.symbol, address: t.address, feed });
    raw.push(entry);
    console.log(`\u2705 ${t.symbol}`);
  }

  fs.writeFileSync(tokensFile, JSON.stringify(valid, null, 2));
  fs.writeFileSync(rawTokensFile, JSON.stringify(raw, null, 2));
  return valid;
}

if (require.main === module) {
  validate().catch(err => console.error(err));
}

module.exports = validate;
