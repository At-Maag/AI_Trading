const { getAddress } = require('ethers');

function safeGetAddress(addr, symbol) {
  try {
    return getAddress(addr);
  } catch (err) {
    console.error(`\u274c Invalid address: ${symbol} - ${addr}`);
    return null;
  }
}

const TOKENS = {
  WETH: safeGetAddress('0x82af49447d8a07e3bd95bd0d56f35241523fbab1', 'WETH'),
  LINK: safeGetAddress('0x6c3f90f043a72fa612cbac8115ee7e52bde6e490', 'LINK'),
  UNI:  safeGetAddress('0xfa7f8980b0f1e64a2062791cc3b0871572f1f7f0', 'UNI'),
  DYDX: safeGetAddress('0x876ec6b529caf409f0f40eadd5c2e3f8f26a4518', 'DYDX'),
  GRT:  safeGetAddress('0x23a941036ae778ac51ab04cea08ed6e2fe103614', 'GRT'),
  RLC:  safeGetAddress('0xc7283b66Eb1EB5FB86327f08e1B5816b0720212B', 'RLC'),
  OCEAN: safeGetAddress('0x7c1c41e89150f2a2d3f7d4d2ce0f0b606ef8a58e', 'OCEAN'),
  WBTC: safeGetAddress('0x2f2a2543b76a4166549f7aaab2e75b3b36adf4c0', 'WBTC'),
  USDC: safeGetAddress('0xaf88d065e77c8cC2239327C5EDb3A432268e5831', 'USDC'),
  USDT: safeGetAddress('0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9', 'USDT'),
};

Object.entries(TOKENS).forEach(([symbol, addr]) => {
  if (!addr) {
    delete TOKENS[symbol];
    return;
  }
  try {
    TOKENS[symbol] = getAddress(addr);
    console.log(`\u2705 Loaded ${symbol}`);
  } catch {
    console.error(`\u274c Invalid address: ${symbol} - ${addr}`);
    delete TOKENS[symbol];
  }
});

module.exports = TOKENS;
