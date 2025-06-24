const trade = require('./trade');
const config = require('./config');

async function getPrices() {
  const prices = {};
  const ethPrice = await trade.getEthPrice();
  prices.eth = ethPrice;
  const coins = config.coins || [];
  for (const symbol of coins) {
    if (['ETH', 'WETH'].includes(symbol)) {
      prices[symbol.toLowerCase()] = ethPrice;
      continue;
    }
    const p = await trade.getTokenUsdPrice(symbol);
    if (p) prices[symbol.toLowerCase()] = p;
  }
  return prices;
}

module.exports = { getPrices };
