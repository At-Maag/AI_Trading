const fs = require('fs');
const path = require('path');
const https = require('https');

const tokenListPath = path.join(__dirname, '..', 'data', 'arbitrum.tokenlist.json');

// Blacklisted symbols that should never be traded
const BLACKLIST = [
  "USDC", "USDT", "DAI", "FRAX", "TUSD", "WBTC", "WETH", "ETH", "ARB", "RETH", "SWETH",
  "MIM", "LUSD", "USDP", "SWUSD", "TBTC", "USD0++", "BERNA", "SPTED", "USHYD", "BGOOGL", "AVRK"
];

// Destination for sale proceeds
const SELL_DESTINATION = (process.env.SELL_DESTINATION || 'WETH').toUpperCase();

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    https.get(url, res => {
      let data = '';
      res.on('data', chunk => (data += chunk));
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch (e) { reject(e); }
      });
    }).on('error', reject);
  });
}

async function fetchTokenCandidates() {
  const url = 'https://raw.githubusercontent.com/Uniswap/token-lists/main/src/tokens/arbitrum.json';
  const data = await fetchJson(url);
  return Array.isArray(data) ? data : (data.tokens || []);
}

async function fetchDexMetrics(address) {
  const url = `https://api.dexscreener.com/latest/dex/tokens/${address}`;
  try {
    const data = await fetchJson(url);
    if (!data || !Array.isArray(data.pairs) || !data.pairs.length) return null;
    const p = data.pairs[0];
    const liq = Number(p.liquidity && p.liquidity.usd) || 0;
    const vol = Number(p.volume && p.volume.h24) || 0;
    const volChange = Math.abs(Number(p.priceChange && p.priceChange.h24) || 0);
    const score = liq / 10000 + vol / 10000 - volChange;
    return { liq, vol, score };
  } catch {
    return null;
  }
}

async function rankTokens(tokens) {
  const scored = [];
  for (const t of tokens) {
    const sym = String(t.symbol).toUpperCase();
    if (BLACKLIST.includes(sym)) continue;
    const metrics = await fetchDexMetrics(t.address);
    if (!metrics) continue;
    scored.push({ symbol: sym, address: t.address, score: metrics.score });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored;
}

function readExistingTokens() {
  try {
    const data = JSON.parse(fs.readFileSync(tokenListPath));
    if (Array.isArray(data.tokens)) return data.tokens;
  } catch {}
  return [];
}

async function refreshTokenList(currentPositions = {}, force = false) {
  let stat;
  try { stat = fs.statSync(tokenListPath); } catch {}
  if (!force && stat && Date.now() - stat.mtimeMs < 12 * 60 * 60 * 1000) {
    return; // not time yet
  }

  const candidates = await fetchTokenCandidates();
  const ranked = await rankTokens(candidates);
  const top = ranked.slice(0, 30); // 25-40 tokens

  const final = [];
  const existing = readExistingTokens();
  const existingMap = {};
  for (const t of existing) existingMap[t.symbol.toUpperCase()] = t.address;

  for (const t of top) {
    final.push({ symbol: t.symbol, address: t.address });
  }

  for (const sym of Object.keys(currentPositions)) {
    const up = sym.toUpperCase();
    if (BLACKLIST.includes(up)) continue;
    const addr = existingMap[up] || currentPositions[sym];
    if (!addr) continue;
    if (!final.find(x => x.symbol === up)) final.push({ symbol: up, address: addr });
  }

  if (!final.find(t => t.symbol === 'WETH')) {
    const addr = existingMap['WETH'] || '0x82af49447d8a07e3bd95bd0d56f35241523fbab1';
    final.unshift({ symbol: 'WETH', address: addr });
  }

  fs.writeFileSync(tokenListPath, JSON.stringify({ tokens: final }, null, 2));
}

module.exports = { refreshTokenList, BLACKLIST, SELL_DESTINATION };
