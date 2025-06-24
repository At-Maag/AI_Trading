try { require('dotenv').config(); } catch {}
const { ethers } = require('ethers');
const fs = require('fs');
const path = require('path');
const trade = require('./trade');
const TOKENS = require('./tokens');
const { getValidTokens } = require('./top25');

async function run() {
  const list = await getValidTokens(process.argv.includes('--force-refresh'));
  let success = 0;
  const failures = [];
  for (const t of list) {
    let addr;
    try {
      addr = ethers.getAddress(t.address);
    } catch {
      failures.push(`${t.symbol} failed (invalid address)`);
      continue;
    }
    const hasLiquidity = await trade.validateLiquidity(TOKENS.WETH, addr, t.symbol);
    if (!hasLiquidity) {
      failures.push(`${t.symbol} failed (no liquidity)`);
      continue;
    }
    const price = await trade.getTokenUsdPrice(t.symbol);
    if (!price) {
      failures.push(`${t.symbol} failed (price fetch failed)`);
      continue;
    }
    success++;
  }
  console.log(`✅ ${success}/${list.length} tokens validated successfully.`);
  failures.forEach(f => console.log(`❌ ${f}`));
}

run().catch(err => {
  console.error('Token test error:', err.message);
});
