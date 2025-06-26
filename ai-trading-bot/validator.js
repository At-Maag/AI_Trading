const fs = require('fs');
const path = require('path');
const { ethers } = require('ethers');
require('dotenv').config();

const tokenListPath = path.join(__dirname, 'data', 'arbitrum.tokenlist.json');
const feedsPath = path.join(__dirname, 'data', 'feeds.json');
const tokensFile = path.join(__dirname, 'tokens.json');

// Remove legacy rawTokens.json if present
const legacyFile = path.join(__dirname, 'rawTokens.json');
if (fs.existsSync(legacyFile)) {
  try { fs.unlinkSync(legacyFile); } catch {}
}

const DEBUG = process.argv.includes('--debug');

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
  const abi = [
    'function latestRoundData() view returns (uint80 roundId,int256 answer,uint256 startedAt,uint256 updatedAt,uint80 answeredInRound)'
  ];

  const tokens = loadTokens();
  const feeds = loadFeeds();
  const valid = [];

  for (const t of tokens) {
    if (!ethers.isAddress(t.address)) continue;
    const feed = feeds[t.symbol];

    if (!feed) {
      console.log(`\u274c ${t.symbol} -> no feed`);
      continue;
    }

    const aggregator = new ethers.Contract(feed, abi, provider);
    let answer;
    try {
      [, answer] = await aggregator.latestRoundData();
    } catch (err) {
      const reason = err.message || 'feed error';
      if (DEBUG) console.error(err);
      console.log(`\u274c ${t.symbol} -> ${feed} ${reason}`);
      continue;
    }

    const num = Number(answer);
    if (!num) {
      console.log(`\u274c ${t.symbol} -> ${feed} price=0`);
      continue;
    }

    valid.push({ symbol: t.symbol, address: t.address, feed });
    console.log(`\u2705 ${t.symbol} -> ${feed}`);
  }

  fs.writeFileSync(tokensFile, JSON.stringify(valid, null, 2));
  return valid;
}

if (require.main === module) {
  validate().catch(err => console.error(err));
}

module.exports = validate;
