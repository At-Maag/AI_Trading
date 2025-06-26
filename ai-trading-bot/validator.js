const fs = require('fs');
const path = require('path');
const { ethers } = require('ethers');
require('dotenv').config();

const tokenListPath = path.join(__dirname, 'data', 'arbitrum.tokenlist.json');
const feedsPath = path.join(__dirname, 'data', 'feeds.json');
const tokensFile = path.join(__dirname, 'data', 'tokens.json');

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

async function validateTokens(tokens, feeds, provider) {
  if (!provider) provider = new ethers.JsonRpcProvider(process.env.ARB_RPC_URL);
  const abi = [
    'function latestRoundData() view returns (uint80 roundId,int256 answer,uint256 startedAt,uint256 updatedAt,uint80 answeredInRound)'
  ];

  if (!tokens) tokens = loadTokens();
  if (!feeds) feeds = loadFeeds();

  const valid = [];

  for (const t of tokens) {
    if (!ethers.isAddress(t.address)) continue;
    const symbol = String(t.symbol).toUpperCase();
    const feed = feeds[symbol];

    if (symbol === 'WETH' && !feed) {
      console.log(`\u274c ${symbol} -> missing feed`);
      continue;
    }

    if (feed) {
      const aggregator = new ethers.Contract(feed, abi, provider);
      let answer;
      try {
        [, answer] = await aggregator.latestRoundData();
      } catch (err) {
        const reason = err.message || 'feed error';
        if (DEBUG) console.error(err);
        console.log(`\u274c ${symbol} -> ${feed} ${reason}`);
        continue;
      }

      const num = Number(answer);
      if (!num) {
        console.log(`\u274c ${symbol} -> ${feed} price=0`);
        continue;
      }
    }

    const entry = { symbol, address: t.address };
    if (feed) entry.feed = feed;
    valid.push(entry);
    console.log(feed ? `\u2705 ${symbol} -> ${feed}` : `\u26A0\uFE0F ${symbol} -> no feed`);
  }

  fs.writeFileSync(tokensFile, JSON.stringify(valid, null, 2));
  return valid;
}

if (require.main === module) {
  validateTokens().catch(err => console.error(err));
}

module.exports = { validateTokens };
