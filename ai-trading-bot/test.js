process.env.PAPER = 'true';
process.env.DRY_RUN = 'true';
require('dotenv').config();

const { ethers } = require('ethers');
const TOKENS = require('./tokens');
const trade = require('./trade');
const { getPrices } = require('./datafeeds');
const { getAddress } = require('ethers');
const { getWethBalance, sellToken } = require('./trade');

const provider = new ethers.JsonRpcProvider('https://arb1.arbitrum.io/rpc');
const wallet = new ethers.Wallet(process.env.PRIVATE_KEY, provider);
const walletAddress = getAddress(wallet.address);

async function main() {
  console.log(`\uD83E\uDDEA Running test at ${new Date().toLocaleTimeString()} (FORCED DRY RUN)`);

  const prices = await getPrices();
  const ethPrice = prices.eth || 0;

  const ethBal = await provider.getBalance(wallet.address);
  const eth = parseFloat(ethers.formatEther(ethBal));
  const weth = await getWethBalance();
  const wethValue = weth * ethPrice;

  console.log(`\n\uD83D\uDCB0 ETH: ${eth.toFixed(5)} | WETH: ${weth.toFixed(5)} ($${wethValue.toFixed(2)})`);

  const topTokens = ['LINK', 'UNI', 'DYDX', 'GRT', 'RLC'];
  console.log('\n\uD83D\uDCCA Token Balances:');
  for (const symbol of topTokens) {
    const addr = TOKENS[symbol];
    if (!addr) continue;
    try {
      const balance = await trade.getTokenBalance(addr, walletAddress, symbol);
      const usd = prices[symbol.toLowerCase()] || 0;
      console.log(`\u2022 ${symbol}: ${balance.toFixed(4)} ($${(balance * usd).toFixed(2)})`);
    } catch (err) {
      console.warn(`\u274c Failed to fetch balance for ${symbol}: ${err.message}`);
    }
  }

  console.log('\n\uD83E\uDDEA Simulating Buy (GRT):');
  try {
    const buyResult = await trade.buy('GRT', { simulate: true, dryRun: true });
    console.log(buyResult);
  } catch (err) {
    console.log(`\u274c Buy test failed: ${err.message}`);
  }

  console.log('\n\uD83E\uDDEA Simulating Sell (DYDX):');
  try {
    const sellResult = await sellToken('DYDX');
    console.log(sellResult);
  } catch (err) {
    console.log(`\u274c Sell test failed: ${err.message}`);
  }

  console.log('\n\u2705 Test complete.\n');
}

main().catch(console.error);
