const axios = require('axios');
const { getAddress } = require('ethers');

const TOKEN_LIST_URL =
  'https://raw.githubusercontent.com/OffchainLabs/arbitrum-token-lists/main/arbed_uniswap_labs.json';

// Minimal fallback list for offline or failed fetch scenarios
const FALLBACK_TOKENS = {
  WETH: '0x82af49447d8a07e3bd95bd0d56f35241523fbab1',
  USDC: '0xff970a61a04b1ca14834a43f5de4533ebddb5cc8',
  USDT: '0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9',
  DAI: '0xda10009cbd5d07dd0cecc66161fc93d7c9000da1',
  WBTC: '0x2f2a2543b76a4166549f7aab2e75b66a2617e72f'
};

const TOKENS = {};
let loaded = false;

async function load() {
  if (loaded) return TOKENS;
  try {
    const { data } = await axios.get(TOKEN_LIST_URL, { timeout: 15000 });
    if (data && Array.isArray(data.tokens)) {
      let count = 0;
      for (const token of data.tokens.slice(0, 200)) {
        if (!token.symbol || !token.address) continue;
        try {
          const addr = getAddress(token.address);
          TOKENS[token.symbol.toUpperCase()] = addr;
          console.log(`\u2705 Loaded ${token.symbol.toUpperCase()} (${addr})`);
          count++;
        } catch {
          console.error(`\u274c Invalid address: ${token.symbol} - ${token.address}`);
        }
      }
      if (count) {
        console.log(`\u2705 ${count} tokens loaded`);
      }
    }
  } catch (err) {
    console.error(`\u274c Failed to fetch token list: ${err.message}`);
  }
  if (!Object.keys(TOKENS).length) {
    console.warn('\u26A0\uFE0F Using fallback token list');
    Object.assign(TOKENS, FALLBACK_TOKENS);
  }
  loaded = true;
  return TOKENS;
}

function getTokenAddress(symbol) {
  return TOKENS[symbol.toUpperCase()] || null;
}

module.exports = TOKENS;
module.exports.load = load;
module.exports.getTokenAddress = getTokenAddress;
module.exports.FALLBACK_TOKENS = FALLBACK_TOKENS;
