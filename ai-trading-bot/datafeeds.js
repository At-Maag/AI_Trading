const axios = require('axios');

async function getPrice(symbol) {
  try {
    const url = `https://api.coingecko.com/api/v3/simple/price?ids=${symbol.toLowerCase()}&vs_currencies=usd`;
    const { data } = await axios.get(url);
    return data[symbol.toLowerCase()].usd;
  } catch (err) {
    console.error('Price fetch error', err.message);
    return null;
  }
}

module.exports = { getPrice };
