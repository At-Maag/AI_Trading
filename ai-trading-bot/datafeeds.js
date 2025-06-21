const axios = require('axios');

// Mapping from token symbol to CoinGecko id
const ID_MAP = {
  ETH: 'ethereum',
  LINK: 'chainlink',
  UNI: 'uniswap',
  ARB: 'arbitrum',
  MATIC: 'matic-network',
  WBTC: 'wrapped-bitcoin',
  AAVE: 'aave',
  COMP: 'compound-governance-token',
  SNX: 'synthetix-network-token',
  SUSHI: 'sushi',
  LDO: 'lido-dao',
  MKR: 'maker',
  CRV: 'curve-dao-token',
  GRT: 'the-graph',
  ENS: 'ethereum-name-service',
  '1INCH': '1inch',
  DYDX: 'dydx',
  BAL: 'balancer',
  BNT: 'bancor',
  OCEAN: 'ocean-protocol',
  BAND: 'band-protocol',
  RLC: 'iexec-rlc',
  AMPL: 'ampleforth',
  STORJ: 'storj'
};

async function getPrices() {
  console.log("\ud83d\udce1 Fetching prices from CoinGecko...");
  try {
    const ids = Object.values(ID_MAP).join(',');
    const res = await axios.get(
      "https://api.coingecko.com/api/v3/simple/price",
      { params: { ids, vs_currencies: "usd" } }
    );
    console.log("\u2705 Price data:", res.data);
    const prices = {};
    for (const [symbol, id] of Object.entries(ID_MAP)) {
      prices[symbol.toLowerCase()] = res.data[id]?.usd;
    }
    return prices;
  } catch (err) {
    console.error("\u274c Price fetch error:", err.message);
    return null;
  }
}

module.exports = { getPrices };

