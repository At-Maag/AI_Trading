require('dotenv').config();
const { ethers } = require('ethers');
const { getValidTokens } = require('./top25');
const TOKENS = require('./tokens');

// Handle keys with or without 0x prefix
const rawKey = (process.env.PRIVATE_KEY || '').trim();
const key = rawKey.startsWith('0x') ? rawKey : '0x' + rawKey;

// Connect to Arbitrum
const provider = new ethers.JsonRpcProvider(process.env.ARB_RPC_URL || 'https://arb1.arbitrum.io/rpc');
const wallet = new ethers.Wallet(key, provider);

// Uniswap V3 Universal Router (used only to verify connectivity)
const router = new ethers.Contract(
  '0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45',
  ['function exactInputSingle((address,address,uint24,address,uint256,uint256,uint160)) payable returns (uint256)'],
  wallet
);

// Chainlink price feeds for a few core tokens
async function getTokenUsdPrice(symbol) {
  const feeds = {
    ETH:  '0x639Fe6ab55C921f74e7fac1ee960C0B6293ba612',
    USDC: '0xfdDB631F5ee37a4bE5bC0a85B59B9c429f9eD6d7',
    USDT: '0x3f3f5dF88dC9F13eac63DF89EC16ef6e7E25DdE7',
    DAI:  '0x6Df09E975c830ECae5bd4eD9d90f3A95a4f88012',
    ARB:  '0x1bAf1eC65f2F41F2bF4FeD927DD1e1e92DA6713b'
  };
  const addr = feeds[symbol.toUpperCase()];
  if (!addr) return null;
  const feed = new ethers.Contract(addr, ['function latestAnswer() view returns (int256)'], provider);
  const raw = await feed.latestAnswer();
  return Number(raw) / 1e8;
}

// Simple Uniswap pair existence + price check
async function validateTokenBeforeTrade(symbol, tokenAddress, wethAddress) {
  if (!tokenAddress || !wethAddress) return false;

  const factory = new ethers.Contract(
    '0x5C69bEe701ef814a2B6a3EDD4B1652CB9cc5aA6f',
    ['function getPair(address,address) external view returns (address)'],
    provider
  );

  try {
    const pair = await factory.getPair(tokenAddress, wethAddress);
    if (!pair || pair === ethers.ZeroAddress) return false;
    const price = await getTokenUsdPrice(symbol);
    return price && price > 0;
  } catch (err) {
    console.warn(`❌ Token validation failed: ${symbol} | ${err.message}`);
    return false;
  }
}

async function runTokenValidation(tokenList, wethAddress) {
  let success = 0;
  for (const { symbol, address } of tokenList) {
    const ok = await validateTokenBeforeTrade(symbol, address, wethAddress);
    if (ok) {
      console.log(`✅ ${symbol} passed`);
      success++;
    } else {
      console.log(`❌ ${symbol} failed`);
    }
  }
  console.log(`\nResult: ${success}/${tokenList.length} tokens validated.`);
}

async function main() {
  const tokens = await getValidTokens(process.argv.includes('--force-refresh'));
  await runTokenValidation(tokens, TOKENS.WETH);
}

main().catch(err => console.error(err));
