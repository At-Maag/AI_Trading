const fs = require('fs');
const path = require('path');
const { ethers } = require('ethers');

const tokenListPath = path.join(__dirname, 'data', 'arbitrum.tokenlist.json');
const feedsPath = path.join(__dirname, 'data', 'feeds.json');
const tokensFile = path.join(__dirname, 'tokens.json');

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

function validate() {
  const tokens = loadTokens();
  const feeds = loadFeeds();
  const valid = [];
  for (const t of tokens) {
    if (!ethers.isAddress(t.address)) continue;
    const feed = feeds[t.symbol];
    if (feed) {
      valid.push({ symbol: t.symbol, address: t.address, feed });
      console.log(`Validated ${t.symbol}`);
    }
  }
  fs.writeFileSync(tokensFile, JSON.stringify(valid, null, 2));
  return valid;
}

if (require.main === module) {
  try {
    validate();
  } catch (err) {
    console.error(err);
  }
}

module.exports = validate;
