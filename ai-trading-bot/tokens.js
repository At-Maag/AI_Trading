// Token address configuration and validation helpers
// This module exports a map of token symbols to checksummed Ethereum
// addresses.  Addresses are normalized using `getAddress` from the
// ethers library so invalid checksums are caught immediately.  Any bad
// address is logged and skipped rather than throwing so the bot
// can continue running safely.

// Ethers v6 exposes utilities directly from the main entry point.
const { getAddress } = require('ethers');
const axios = require('axios');
const { ID_MAP } = require('./datafeeds');

// Prefer Arbitrum addresses but fall back to Ethereum mainnet if not present
const PLATFORM_KEY = 'arbitrum-one';

function safeGetAddress(addr, symbol) {
  try {
    return getAddress(addr);
  } catch (err) {
    console.error(`\u274c Invalid address: ${symbol} - ${addr}`);
    return null;
  }
}

const TOKENS = {
  // Ensure the WETH address is using the proper checksum. A mixed-case
  // address without a valid checksum triggers ethers.getAddress() to
  // throw an INVALID_ARGUMENT error at startup.
  // Arbitrum WETH address
  WETH: safeGetAddress('0x82af49447d8a07e3bd95bd0d56f35241523fbab1', 'WETH'),
  LINK: safeGetAddress('0x514910771af9ca656af840dff83e8264ecf986ca', 'LINK'),
  UNI: safeGetAddress('0x1f9840a85d5af5bf1d1762f925bdaddc4201f984', 'UNI'),
  ARB: safeGetAddress('0x912ce59144191c1204e64559fe8253a0e49e6548', 'ARB'),
  MATIC: safeGetAddress('0x7d1afa7b718fb893db30a3abc0cfc608aacfebb0', 'MATIC'),
  MKR: safeGetAddress('0x9f8f72aa9304c8b593d555f12ef6589cc3a579a2', 'MKR'),
  USDC: safeGetAddress('0xff970a61a04b1ca14834a43f5de4533ebddb5cc8', 'USDC'),
  USDT: safeGetAddress('0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9', 'USDT'),
  CRV: safeGetAddress('0xd533a949740bb3306d119cc777fa900ba034cd52', 'CRV'),
  GRT: safeGetAddress('0xc944e90c64b2c07662a292be6244bdf05cda44a7', 'GRT'),
  ENS: safeGetAddress('0xc18360217d8f7ab5e5edd226be63ede2a818f5e9', 'ENS'),
  '1INCH': safeGetAddress('0x111111111117dc0aa78b770fa6a738034120c302', '1INCH'),
  DYDX: safeGetAddress('0x92d6c1e31e14520e676a687f0a93788b716beff5', 'DYDX'),
  WBTC: safeGetAddress('0x2260fac5e5542a773aa44fbcfedf7c193bc2c599', 'WBTC'),
  AAVE: safeGetAddress('0x7fc66500c84a76ad7e9c93437bfc5ac33e2ddae9', 'AAVE'),
  COMP: safeGetAddress('0xc00e94cb662c3520282e6f5717214004a7f26888', 'COMP'),
  SNX: safeGetAddress('0xc011a72400e58ecd99ee497cf89e3775d4bd732f', 'SNX'),
  SUSHI: safeGetAddress('0x6b3595068778dd592e39a122f4f5a5cf09c90fe2', 'SUSHI'),
  LDO: safeGetAddress('0x5a98fcbea516cf06857215779fd812ca3bef1b32', 'LDO'),
  BAL: safeGetAddress('0xba100000625a3754423978a60c9317c58a424e3d', 'BAL'),
  BNT: safeGetAddress('0x1f573d6fb3f13d689ff844b4c6deebd4994e9e6f', 'BNT'),
  REN: safeGetAddress('0x408e41876cccdc0f92210600ef50372656052a38', 'REN'),
  OCEAN: safeGetAddress('0x967da4048cd07ab37855c090aaf366e4ce1b9f48', 'OCEAN'),
  BAND: safeGetAddress('0xba11d479a30a3dba9281e1d8e6ce942ca109b3a6', 'BAND'),
  RLC: safeGetAddress('0x607f4c5bb672230e8672085532f7e901544a7375', 'RLC'),
  AMPL: safeGetAddress('0xd46ba6d942050d489dbd938a2c909a5d5039a161', 'AMPL'),
  STORJ: safeGetAddress('0xb64ef51c888972c908cfacf59b47c1afbc0ab8ac', 'STORJ'),
};

async function fetchAddress(symbol) {
  const id = ID_MAP[symbol.toUpperCase()];
  if (!id) return null;
  try {
    const { data } = await axios.get(
      `https://api.coingecko.com/api/v3/coins/${id}`,
      { timeout: 10000 }
    );
    const addr = data?.platforms?.[PLATFORM_KEY] || data?.platforms?.ethereum;
    if (addr) return getAddress(addr);
  } catch (err) {
    console.warn(`\u26A0\uFE0F Address lookup failed for ${symbol}: ${err.message}`);
  }
  return null;
}

async function getTokenAddress(symbol) {
  symbol = symbol.toUpperCase();
  if (TOKENS[symbol]) return TOKENS[symbol];
  const addr = await fetchAddress(symbol);
  if (addr) {
    TOKENS[symbol] = addr;
    console.log(`\u2705 Loaded ${symbol} via CoinGecko`);
    return addr;
  }
  return null;
}

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

// Provide aliases for native symbols so external modules can request either
// the wrapped or unwrapped version transparently. This avoids issues when
// a component passes 'ETH' or 'BTC' instead of their wrapped equivalents.
TOKENS.ETH = TOKENS.WETH;
TOKENS.BTC = TOKENS.WBTC;
TOKENS.getTokenAddress = getTokenAddress;

module.exports = TOKENS;
