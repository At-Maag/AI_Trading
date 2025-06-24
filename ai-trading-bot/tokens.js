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
  ARB:   safeGetAddress('0x912CE59144191C1204E64559FE8253a0e49E6548', 'ARB'),
  MATIC: safeGetAddress('0xeadD5e4720d92C17c0A7f0d2f3E9eC1e054f9C6A', 'MATIC'),
  CRV:   safeGetAddress('0x498A17C58E2C1A1D16c0c931D6a523e1B16eBf3f', 'CRV'),
  BAL:   safeGetAddress('0x040d1edc9569d4bab2d15287dc5a4f10f56a56b8', 'BAL'),
  SNX:   safeGetAddress('0x34dEbEF4e420dF21c1c4b7E627e4c197bD9F7A01', 'SNX'),
  LDO:   safeGetAddress('0xDae6C2A48bfaa0b4c6e580419b6dC7861A01377B', 'LDO'),
  SUSHI: safeGetAddress('0x6c3f90f043a72fa612cbac8115ee7e52bde6e490', 'SUSHI'),
  AAVE:  safeGetAddress('0x078f358208685046a11C85e8ad32895DED33A249', 'AAVE'),
  COMP:  safeGetAddress('0x354A6dA3fcde098F8389cad84b0182725c6C91dE', 'COMP'),
  BAND:  safeGetAddress('0x0d9c36109c8ef5d8ee093c9ebfa2b8b5b83e0766', 'BAND'),
  AMPL:  safeGetAddress('0x43b4fdfd4ff969587185cdb6f0bd875c5fc83f8c', 'AMPL'),
  REN:   safeGetAddress('0x5c2ed810328349100A66B82b78a1791B101C9D61', 'REN'),
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
