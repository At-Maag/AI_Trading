const ethers = require('ethers');

function safeGetAddress(addr, symbol) {
  try {
    return ethers.getAddress(addr);
  } catch {
    console.error(`\u274c Invalid address: ${symbol} - ${addr}`);
    return null;
  }
}

const TOKENS = {
  WETH:  safeGetAddress('0x82af49447d8a07e3bd95bd0d56f35241523fbab1', 'WETH'),
  USDC:  safeGetAddress('0xaf88d065e77c8cc2239327c5edb3a432268e5831', 'USDC'),
  USDT:  safeGetAddress('0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9', 'USDT'),
  DAI:   safeGetAddress('0xda10009cbd5d07dd0cecc66161fc93d7c9000da1', 'DAI'),
  ARB:   safeGetAddress('0x912ce59144191c1204e64559fe8253a0e49e6548', 'ARB'),
  UNI:   safeGetAddress('0xfa7f8980b0f1e64a2062791cc3b0871572f1f7f0', 'UNI'),
  LINK:  safeGetAddress('0x86e3bBEc5eEb16fC1ed6f62B8bC10f5a033f8d99', 'LINK'),
  AAVE:  safeGetAddress('0x078f358208685046a11c85e8ad32895ded33a249', 'AAVE'),
  MATIC: safeGetAddress('0x4f3aff3a747fcade12598081e80c6605a8be192f', 'MATIC'),
  CRV:   safeGetAddress('0x11cdb42b0eb46d95f990bedd4695a6e3fa034978', 'CRV'),
  SUSHI: safeGetAddress('0x39c437d2ce831f0aa0eae7f46424a8f424b2b548', 'SUSHI'),
  BAL:   safeGetAddress('0x040d1edc9569d4bab2d15287dc5a4f10f56a56b8', 'BAL'),
  COMP:  safeGetAddress('0xf2a52fe0dceaddadf621a66e7c6c0e9d3e1946ce', 'COMP'),
  GRT:   safeGetAddress('0xc944e90c64b2c07662a292be6244bdf05cda44a7', 'GRT'),
  RPL:   safeGetAddress('0xb766039cc6db368759c1e56b79affe831d0cc507', 'RPL'),
  GMX:   safeGetAddress('0xfc5a1a6eb076a2c7a3c37c1300f00bcd5b3bddd1', 'GMX'),
  JONES: safeGetAddress('0x10393c20975cf177a3513071bc110f7962cd67da', 'JONES'),
  DPX:   safeGetAddress('0x6c2f6b6111224fca50edcdf2c2a79dcdedecf069', 'DPX'),
  LQTY:  safeGetAddress('0x56315b90c40730925ec5485cf004d835058518cc', 'LQTY'),
  MAGIC: safeGetAddress('0x539bdE0d7Dbd336b79148AA742883198BBF60342', 'MAGIC'),
  IMX:   safeGetAddress('0x6468e79a80c0ea8ece9e6b665a3fddf0c6dd5e3b', 'IMX'),
  AXS:   safeGetAddress('0x7c9f4c87d911613fe9ca8eb7c2c2404256c41202', 'AXS'),
  RARI:  safeGetAddress('0x95a4492f028aa1fd432ea71146b433e7b4446611', 'RARI'),
  XCAD:  safeGetAddress('0xe4cfe9eaa8cdb0942a80b7bc68fd8ab0f6d44903', 'XCAD'),
  RND:   safeGetAddress('0x567e868c14057572b9f49c2d5657b5d4c7cb6525', 'RND'),
  OP:    safeGetAddress('0x4200000000000000000000000000000000000042', 'OP'),
  METIS: safeGetAddress('0x52bfe8d9c5f36c73806c6e6dce1f51e1c81dc0cb', 'METIS'),
  BAND:  safeGetAddress('0x46c6f7ec2868d39c5b8ce7a0106f1c48a5dff4e6', 'BAND'),
  DIA:   safeGetAddress('0x865377367054516e17014ccded1e7d814edc9ce4', 'DIA'),
  UMA:   safeGetAddress('0x20f6a4f3a108296af641b98c340f3f999ea5c00d', 'UMA'),
  VELA:  safeGetAddress('0x088cd8f5ef3652623c22d48b1605dcfe860cd704', 'VELA'),
  DOPEX: safeGetAddress('0x6c2f6b6111224fca50edcdf2c2a79dcdedecf069', 'DOPEX'),
  SYN:   safeGetAddress('0x080f6aed32fc474dd5717105dba5ea57268f46eb', 'SYN'),
  HND:   safeGetAddress('0x10010078a54396f62c96df8532dc2b4847d47ed3', 'HND'),
  FRAX:  safeGetAddress('0x17fc002b466eec40dae837fc4be5c67993ddbd6f', 'FRAX'),
  PEPE:  safeGetAddress('0x4ecaba5870353805a9f068101a40e0f32ed605c6', 'PEPE'),
  DOGE:  safeGetAddress('0x7a58c0be72be218b41c608b7fe7c5bb630736c71', 'DOGE'),
  FLOKI: safeGetAddress('0x76352f3f188ee7e4d7fa0c8fc41c40e14ea9b9e5', 'FLOKI'),
  TURBO: safeGetAddress('0x02cd50be8e5dfb9e6de7a8d4c8b3f3c93f049c41', 'TURBO'),
  BONK:  safeGetAddress('0x6ca6a7dc0c8b8d2f20dcfd2fd93e9d33b3c9e74a', 'BONK'),
  LPT:   safeGetAddress('0x289ba1701c2f088cf0faf8b3705246331cb8a839', 'LPT'),
  ENS:   safeGetAddress('0x65559aa14915a70190438ef90104769e5e890a00', 'ENS'),
  LOOKS: safeGetAddress('0xf4d2888d29d722226fafa5d9b24f9164c092421e', 'LOOKS'),
  TCR:   safeGetAddress('0x408d4cd0adb7cebd1f1a1c33a0ba2098e1295e97', 'TCR'),
  SPELL: safeGetAddress('0x1f3a3ca08fbf94c2f28588e7fd208995be3e3f04', 'SPELL')
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
