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
  WETH:   safeGetAddress('0x82af49447d8a07e3bd95bd0d56f35241523fbab1', 'WETH'),
  USDC:   safeGetAddress('0xaf88d065e77c8cc2239327c5edb3a432268e5831', 'USDC'),
  USDT:   safeGetAddress('0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9', 'USDT'),
  WBTC:   safeGetAddress('0x2f2a2543b76a4166549f7aaab2e75b3b36adf4c0', 'WBTC'),
  LINK:   safeGetAddress('0x514910771af9ca656af840dff83e8264ecf986ca', 'LINK'),
  UNI:    safeGetAddress('0x1f9840a85d5af5bf1d1762f925bdaddc4201f984', 'UNI'),
  AAVE:   safeGetAddress('0x078f358208685046a11c85e8ad32895ded33a249', 'AAVE'),
  CRV:    safeGetAddress('0xd533a949740bb3306d119cc777fa900ba034cd52', 'CRV'),
  BAL:    safeGetAddress('0xba100000625a3754423978a60c9317c58a424e3d', 'BAL'),
  GRT:    safeGetAddress('0xc944e90c64b2c07662a292be6244bdf05cda44a7', 'GRT'),
  SNX:    safeGetAddress('0xc011a72400e58ecd99ee497cf89e3775d4bd732f', 'SNX'),
  LDO:    safeGetAddress('0x5a98fcbea516cf068572fc73432788efefd76c4', 'LDO'),
  COMP:   safeGetAddress('0xc00e94cb662c3520282e6f5717214004a7f26888', 'COMP'),
  MKR:    safeGetAddress('0x9f8f72aa9304c8b593d555f12ef6589cc3a579a2', 'MKR'),
  RLC:    safeGetAddress('0xaa944fabe24f9e87ed6be4c584b366373e5781c4', 'RLC'),
  DYDX:   safeGetAddress('0x92d6c1e31e14520e676a687f0a93788b716beff5', 'DYDX'),
  AMPL:   safeGetAddress('0xc4dd4a61f90077ab7a3682708fecd9e5e32fa50e', 'AMPL'),
  BAND:   safeGetAddress('0xba11d479a30a3dba9281e1d8e6ce942ca109b3a6', 'BAND'),
  REN:    safeGetAddress('0x526fcd0a1d06f69e97bd9be0efac8ed04a1819aa', 'REN'),
  FXS:    safeGetAddress('0x9d2f2998c7be06c75610f6ee0e5d7f2130bcb72d', 'FXS'),
  YFI:    safeGetAddress('0x82e3a8f066a6989666b031d916c43672085b1582', 'YFI'),
  STG:    safeGetAddress('0x5f56a1a2d3d0f1dbb9a70872f3d05259170c248f', 'STG'),
  SPELL:  safeGetAddress('0x1e5f5c358c0d86b86b35f7c71579eb6b3a67078e', 'SPELL'),
  GALA:   safeGetAddress('0x15d4c048f83bd7e37d49ea4c83a07267ec4203da', 'GALA'),
  PEPE:   safeGetAddress('0x25d887ce7a35172c62fefd67a1856f20faeb8000', 'PEPE'),
  MAGIC:  safeGetAddress('0x2c852d3334188be136bfc540ef2b8b5c37b590bad', 'MAGIC'),
  FRAX:   safeGetAddress('0x17fc002b466eec40daa837fc4eb5c67993ddbdf6', 'FRAX'),
  GMX:    safeGetAddress('0x6f0f0e77ec8fd2fceb2614e84c3a1f6c8b775d79', 'GMX'),
  LPT:    safeGetAddress('0x289ba1701c2f088cf0faf8b3705246331c839', 'LPT'),
  PENDLE: safeGetAddress('0x0c880f6761f1af8d9aa9c466984b80dab9a8c9e8', 'PENDLE'),
  CHR:    safeGetAddress('0x15b2fb8f08e4ac1ce019eadae02ee92aedf06851', 'CHR'),
  BADGER: safeGetAddress('0x1f1ef07fd8c64de3b7e8edbe6d36a7a9e521b5a5', 'BADGER'),
  ALCX:   safeGetAddress('0xd20251bb44c3eaef0ad735cbcbd40ecdac5f3ef2', 'ALCX'),
  ICE:    safeGetAddress('0xeef9f339514298c6a857efcfc1a762af84438dee', 'ICE'),
  LRC:    safeGetAddress('0xaa944fabe24f9e87ed6be4c584b366373e5781c4', 'LRC'),
};

Object.entries(TOKENS).forEach(([symbol, addr]) => {
  if (!addr) return delete TOKENS[symbol];
  try {
    getAddress(addr);
    console.log(`\u2705 Loaded ${symbol}`);
  } catch {
    console.error(`\u274c Invalid ${symbol}`);
    delete TOKENS[symbol];
  }
});

async function load() {
  return TOKENS;
}

function getTokenAddress(symbol) {
  return TOKENS[symbol.toUpperCase()] || null;
}

module.exports = TOKENS;
module.exports.load = load;
module.exports.getTokenAddress = getTokenAddress;
module.exports.FALLBACK_TOKENS = TOKENS;
