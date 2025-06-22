// Token address configuration and validation helpers
// This file exports a map of token symbols to checksummed Ethereum addresses.
// Addresses are normalized using ethers.utils.getAddress and validated at load
// time to ensure checksum correctness.

const { getAddress } = require('ethers').utils;

const TOKENS = {
  WETH: getAddress('0xC02aaA39b223fe8d0a0e5c4f27ead9083c756cc2'),
  LINK: getAddress('0x514910771af9ca656af840dff83e8264ecf986ca'),
  UNI: getAddress('0x1f9840a85d5af5bf1d1762f925bdaddc4201f984'),
  ARB: getAddress('0x912ce59144191c1204e64559fe8253a0e49e6548'),
  MATIC: getAddress('0x7d1afa7b718fb893db30a3abc0cfc608aacfebb0'),
  MKR: getAddress('0x9f8f72aa9304c8b593d555f12ef6589cc3a579a2'),
  CRV: getAddress('0xd533a949740bb3306d119cc777fa900ba034cd52'),
  GRT: getAddress('0xc944e90c64b2c07662a292be6244bdf05cda44a7'),
  ENS: getAddress('0xc18360217d8f7ab5e5edd226be63ede2a818f5e9'),
  '1INCH': getAddress('0x111111111117dc0aa78b770fa6a738034120c302'),
  DYDX: getAddress('0x92d6c1e31e14520e676a687f0a93788b716beff5'),
  WBTC: getAddress('0x2260fac5e5542a773aa44fbcfedf7c193bc2c599'),
  AAVE: getAddress('0x7fc66500c84a76ad7e9c93437bfc5ac33e2ddae9'),
  COMP: getAddress('0xc00e94cb662c3520282e6f5717214004a7f26888'),
  SNX: getAddress('0xc011a72400e58ecd99ee497cf89e3775d4bd732f'),
  SUSHI: getAddress('0x6b3595068778dd592e39a122f4f5a5cf09c90fe2'),
  LDO: getAddress('0x5a98fcbea516cf06857215779fd812ca3bef1b32'),
  BAL: getAddress('0xba100000625a3754423978a60c9317c58a424e3d'),
  BNT: getAddress('0x1f573d6fb3f13d689ff844b4c6deebd4994e9e6f'),
  REN: getAddress('0x408e41876cccdc0f92210600ef50372656052a38'),
  OCEAN: getAddress('0x967da4048cd07ab37855c090aaf366e4ce1b9f48'),
  BAND: getAddress('0xba11d479a30a3dba9281e1d8e6ce942ca109b3a6'),
  RLC: getAddress('0x607f4c5bb672230e8672085532f7e901544a7375'),
  AMPL: getAddress('0xd46ba6d942050d489dbd938a2c909a5d5039a161'),
  STORJ: getAddress('0xb64ef51c888972c908cfacf59b47c1afbc0ab8ac'),
};

Object.entries(TOKENS).forEach(([symbol, addr]) => {
  try {
    TOKENS[symbol] = getAddress(addr);
  } catch (err) {
    console.error(`\u274c Invalid address for ${symbol}: ${addr}`);
    throw err;
  }
});

module.exports = TOKENS;
