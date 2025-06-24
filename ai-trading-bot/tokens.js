const { getAddress } = require('ethers');

function safeGetAddress(addr, symbol) {
  try {
    return getAddress(addr);
  } catch {
    console.error(`\u274c Invalid address: ${symbol} - ${addr}`);
    return null;
  }
}

const TOKENS = {
  WETH:  safeGetAddress('0x82af49447d8a07e3bd95bd0d56f35241523fbab1', 'WETH'),
  LINK:  safeGetAddress('0x514910771af9ca656af840dff83e8264ecf986ca', 'LINK'),
  UNI:   safeGetAddress('0x1f9840a85d5af5bf1d1762f925bdaddc4201f984', 'UNI'),
  DYDX:  safeGetAddress('0x92d6c1e31e14520e676a687f0a93788b716beff5', 'DYDX'),
  GRT:   safeGetAddress('0xc944e90c64b2c07662a292be6244bdf05cda44a7', 'GRT'),
  RLC:   safeGetAddress('0xaa944fabe24f9e87ed6be4c584b366373e5781c4', 'RLC'),
  OCEAN: safeGetAddress('0x967da4048cd07ab37855c090aaf366e4ce1b9f48', 'OCEAN'),
  WBTC:  safeGetAddress('0x2f2a2543b76a4166549f7aaab2e75b3b36adf4c0', 'WBTC'),
  USDC:  safeGetAddress('0xaf88d065e77c8cc2239327c5edb3a432268e5831', 'USDC'),
  USDT:  safeGetAddress('0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9', 'USDT'),
  ARB:   safeGetAddress('0x912ce59144191c1204e64559fe8253a0e49e6548', 'ARB'),
  MATIC: safeGetAddress('0x7d1afa7b718fb893db30a3abc0cfc608aacfebb0', 'MATIC'),
  CRV:   safeGetAddress('0xd533a949740bb3306d119cc777fa900ba034cd52', 'CRV'),
  BAL:   safeGetAddress('0xba100000625a3754423978a60c9317c58a424e3d', 'BAL'),
  SNX:   safeGetAddress('0xc011a72400e58ecd99ee497cf89e3775d4bd732f', 'SNX'),
  LDO:   safeGetAddress('0x5A98FcBEA516Cf068572fF7Ef72e37A6b591C34F', 'LDO'),
  SUSHI: safeGetAddress('0x6b3595068778dd592e39a122f4f5a5cf09c90fe2', 'SUSHI'),
  AAVE:  safeGetAddress('0x078f358208685046a11c85e8ad32895ded33a249', 'AAVE'),
  COMP:  safeGetAddress('0xc00e94cb662c3520282e6f5717214004a7f26888', 'COMP'),
  BAND:  safeGetAddress('0xba11d479a30a3dba9281e1d8e6ce942ca109b3a6', 'BAND'),
  AMPL:  safeGetAddress('0xc4dd4a61f90077ab7a3682708fecd9e5e32fa50e', 'AMPL'),
  REN:   safeGetAddress('0x526fcd0a1d06f69e97bd9be0efac8ed04a1819aa', 'REN')
};

const FALLBACK_TOKENS = TOKENS;

function getTokenAddress(symbol) {
  return TOKENS[symbol.toUpperCase()] || null;
}

function getValidTokens() {
  return Object.entries(TOKENS)
    .filter(([, addr]) => addr !== null)
    .map(([symbol, address]) => ({ symbol, address }));
}

module.exports = TOKENS;
module.exports.getTokenAddress = getTokenAddress;
module.exports.getValidTokens = getValidTokens;
module.exports.FALLBACK_TOKENS = FALLBACK_TOKENS;
