const axios = require('axios');

async function getPrices() {
  console.log("\ud83d\udce1 Fetching prices from CoinGecko...");
  try {
    const res = await axios.get("https://api.coingecko.com/api/v3/simple/price", {
      params: {
        ids: "ethereum,polygon,chainlink,uniswap,arbitrum",
        vs_currencies: "usd"
      }
    });
    console.log("\u2705 Price data:", res.data);
    return {
      eth: res.data.ethereum?.usd,
      matic: res.data.polygon?.usd,
      link: res.data.chainlink?.usd,
      uni: res.data.uniswap?.usd,
      arb: res.data.arbitrum?.usd
    };
  } catch (err) {
    console.error("\u274c Price fetch error:", err.message);
    return null;
  }
}

module.exports = { getPrices };

