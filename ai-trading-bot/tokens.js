const ethers = require('ethers');

function safeGetAddress(addr, symbol) {
  try {
    return ethers.getAddress(addr);
  } catch {
    console.error(`❌ Invalid address: ${symbol} - ${addr}`);
    return null;
  }
}

const TOKENS = {
  WETH:  safeGetAddress('0x82af49447d8a07e3bd95bd0d56f35241523fbab1', 'WETH'),
  USDC:  safeGetAddress('0xaf88d065e77c8cc2239327c5edb3a432268e5831', 'USDC'),
  USDT:  safeGetAddress('0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9', 'USDT'),
  DAI:   safeGetAddress('0xda10009cbd5d07dd0cecc66161fc93d7c9000da1', 'DAI'),
  ARB:   safeGetAddress('0x912ce59144191c1204e64559fe8253a0e49e6548', 'ARB'),
  AAVE:  safeGetAddress('0x078f358208685046a11c85e8ad32895ded33a249', 'AAVE'),
  UNI:   safeGetAddress('0xfa7f8980b0f1e64a2062791cc3b0871572f1f7f0', 'UNI'),
 LINK:  safeGetAddress('0x86E3bBEc5eEb16Fc1ed6F62B8bC10f5a033F8d99', 'LINK'),
  GMX:   safeGetAddress('0xfc5a1a6eb076a2c7a3c37c1300f00bcd5b3bddd1', 'GMX'),
  MAGIC: safeGetAddress('0x539bdE0d7Dbd336b79148AA742883198BBF60342', 'MAGIC'),
  MATIC: safeGetAddress('0x4f3aff3a747fcade12598081e80c6605a8be192f', 'MATIC'),
  CRV:   safeGetAddress('0x11cdb42b0eb46d95f990bedd4695a6e3fa034978', 'CRV'),
  SUSHI: safeGetAddress('0x39c437d2ce831f0aa0eae7f46424a8f424b2b548', 'SUSHI'),
  BAL:   safeGetAddress('0x040d1edc9569d4bab2d15287dc5a4f10f56a56b8', 'BAL'),
  LDO:   safeGetAddress('0xb766039cc6db368759c1e56b79affe831d0cc507', 'LDO'),
  COMP:  safeGetAddress('0xf2a52fe0dceaddadf621a66e7c6c0e9d3e1946ce', 'COMP'),
  GRT:   safeGetAddress('0xc944e90c64b2c07662a292be6244bdf05cda44a7', 'GRT'),
  JONES: safeGetAddress('0x10393c20975cf177a3513071bc110f7962cd67da', 'JONES'),
  LQTY:  safeGetAddress('0x56315b90c40730925ec5485cf004d835058518cc', 'LQTY'),
  RPL:   safeGetAddress('0xb766039cc6db368759c1e56b79affe831d0cc507', 'RPL'),
  OP:    safeGetAddress('0x4200000000000000000000000000000000000042', 'OP'),
  VELA:  safeGetAddress('0x088cd8f5ef3652623c22d48b1605dcfe860cd704', 'VELA'),
  DPX:   safeGetAddress('0x6c2f6b6111224fca50edcdf2c2a79dcdedecf069', 'DPX'),
  SYN:   safeGetAddress('0x080f6aed32fc474dd5717105dba5ea57268f46eb', 'SYN'),
  RDPX:  safeGetAddress('0x0ff5a8451a839f5f0bb3562689d9a44089738d11', 'RDPX'),
  HND:   safeGetAddress('0x10010078a54396f62c96df8532dc2b4847d47ed3', 'HND'),
  YFI:   safeGetAddress('0x9f11c8d99b33c1a101a38455eec2d15ad8b71653', 'YFI'),
  MIM:   safeGetAddress('0xB153FB3d196A8eB25522705560ac152eeEc57901', 'MIM'),
  METIS: safeGetAddress('0x52bfe8d9c5f36c73806c6e6dce1f51e1c81dc0cb', 'METIS'),
  FXS:   safeGetAddress('0x9d1a62c7e4e9f246c7493fbd3e34c08e2bc3ae6b', 'FXS'),
  FRAX:  safeGetAddress('0x17fc002b466eec40dae837fc4be5c67993ddbd6f', 'FRAX'),
  LPT:   safeGetAddress('0x289ba1701c2f088cf0faf8b3705246331cb8a839', 'LPT'),
  ENS:   safeGetAddress('0x65559aa14915a70190438ef90104769e5e890a00', 'ENS'),
  LOOKS: safeGetAddress('0xf4d2888d29d722226fafa5d9b24f9164c092421e', 'LOOKS'),
  TCR:   safeGetAddress('0x408d4cd0adb7cebd1f1a1c33a0ba2098e1295e97', 'TCR'),
  SPELL: safeGetAddress('0x1f3a3ca08fbf94c2f28588e7fd208995be3e3f04', 'SPELL'),
  PEPE:  safeGetAddress('0x4ecaba5870353805a9f068101a40e0f32ed605c6', 'PEPE'),
  DOGE:  safeGetAddress('0x7a58c0be72be218b41c608b7fe7c5bb630736c71', 'DOGE'),
  FLOKI: safeGetAddress('0x76352f3f188ee7e4d7fa0c8fc41c40e14ea9b9e5', 'FLOKI'),
  TURBO: safeGetAddress('0x02cd50be8e5dfb9e6de7a8d4c8b3f3c93f049c41', 'TURBO'),
  BONK:  safeGetAddress('0x6ca6a7dc0c8b8d2f20dcfd2fd93e9d33b3c9e74a', 'BONK'),
  STG:   safeGetAddress('0x2F6bD26E5004e58fC6A1E3cD3fACfa68C5bC6846', 'STG'),
  RDNT:  safeGetAddress('0x0C4681e6C0235179ec3D4F4fc4DF3d14FDD96017', 'RDNT'),
  GNS:   safeGetAddress('0x18c11fd286c5ec11c3b683caa813b77f5163a122', 'GNS'),
  PLS:   safeGetAddress('0x51318b7d00db7acc4026c88c3952b66278b6a67f', 'PLS'),
  HOP:   safeGetAddress('0xb8901acb165ed027e32754e0ffe830802919727f', 'HOP'),
  COW:   safeGetAddress('0xDAe6C1D1aC5D68e1F7Cc1C6F2f1531eF5bD2C6CB', 'COW')
};

const FALLBACK_TOKENS = TOKENS;

async function load() {
  return TOKENS;
}

function getTokenAddress(symbol) {
  return TOKENS[symbol.toUpperCase()] || null;
}

function getValidTokens() {
  return Object.entries(TOKENS)
    .filter(([, addr]) => addr !== null)
    .map(([symbol, address]) => ({ symbol, address }));
}

module.exports = TOKENS;
module.exports.load = load;
module.exports.getTokenAddress = getTokenAddress;
module.exports.getValidTokens = getValidTokens;
module.exports.FALLBACK_TOKENS = FALLBACK_TOKENS;
