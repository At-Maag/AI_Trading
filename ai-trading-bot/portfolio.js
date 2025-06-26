const fs = require('fs');
const path = require('path');
const { ethers } = require('ethers');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const provider = new ethers.JsonRpcProvider(process.env.ARB_RPC_URL || 'https://arb1.arbitrum.io/rpc');
const wallet = process.env.WALLET || ethers.ZeroAddress;

const feedAbi = [
  'function latestAnswer() view returns (int256)',
  'function decimals() view returns (uint8)'
];
const erc20Abi = [
  'function balanceOf(address) view returns (uint256)',
  'function decimals() view returns (uint8)',
  'function symbol() view returns (string)'
];

async function main() {
  const tokensFile = path.join(__dirname, 'tokens.json');
  if (!fs.existsSync(tokensFile)) {
    console.error('tokens.json not found. Run validator first.');
    return;
  }

  const tokens = JSON.parse(fs.readFileSync(tokensFile));
  const rows = [];
  let total = 0;

  for (const t of tokens) {
    try {
      const token = new ethers.Contract(t.address, erc20Abi, provider);
      const feed = new ethers.Contract(t.feed, feedAbi, provider);
      const [bal, tDec, priceRaw, pDec] = await Promise.all([
        token.balanceOf(wallet),
        token.decimals(),
        feed.latestAnswer(),
        feed.decimals()
      ]);
      const balance = Number(ethers.formatUnits(bal, tDec));
      const price = Number(priceRaw) / 10 ** pDec;
      const value = balance * price;
      total += value;
      rows.push({ Symbol: t.symbol, Quantity: balance.toFixed(4), PriceUSD: price.toFixed(4), TotalUSD: value.toFixed(2) });
    } catch (err) {
      console.log(`Failed ${t.symbol}: ${err.message}`);
    }
  }

  console.table(rows);
  console.log(`Total Portfolio USD: $${total.toFixed(2)}`);
}

if (require.main === module) {
  main().catch(err => console.error(err));
}
