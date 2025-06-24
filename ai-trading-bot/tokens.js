const axios = require('axios');
const { getAddress } = require('ethers');

const TOKEN_LIST_URL = 'https://raw.githubusercontent.com/OffchainLabs/arbitrum-token-lists/master/arbed_uniswap_labs.json';

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
      console.log(`\u2705 ${count} tokens loaded`);
    }
  } catch (err) {
    console.error(`\u274c Failed to fetch token list: ${err.message}`);
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
