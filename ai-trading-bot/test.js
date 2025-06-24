process.env.PAPER = 'true';
process.env.DRY_RUN = 'true';
require('dotenv').config();

const { ethers } = require('ethers');
const TOKENS = require('./tokens');
const trade = require('./trade');
const { getPrices } = require('./datafeeds');
const { getAddress } = require('ethers');
const { getWethBalance, sellToken } = require('./trade');
const strategy = require('./strategy');

const provider = new ethers.JsonRpcProvider('https://arb1.arbitrum.io/rpc');
const wallet = new ethers.Wallet(process.env.PRIVATE_KEY, provider);
const walletAddress = getAddress(wallet.address);

async function main() {
  console.log(`🧪 Running test at ${new Date().toLocaleTimeString()} (FORCED DRY RUN)`);

  await TOKENS.load();

  const prices = await getPrices();
  const ethPrice = prices.eth || 0;

  const ethBal = await provider.getBalance(wallet.address);
  const eth = parseFloat(ethers.formatEther(ethBal));
  const weth = await getWethBalance();
  const wethValue = weth * ethPrice;

  console.log(`\n💰 ETH: ${eth.toFixed(5)} | WETH: ${weth.toFixed(5)} ($${wethValue.toFixed(2)})`);

  const topTokens = ['LINK', 'UNI', 'DYDX', 'GRT', 'RLC', 'OCEAN'];
  console.log('\n📊 Token Balances & PnL Estimations:');
  for (const symbol of topTokens) {
    const addr = TOKENS[symbol];
    if (!addr) continue;
    try {
      const balance = await trade.getTokenBalance(addr, walletAddress, symbol);
      const usd = prices[symbol.toLowerCase()] || 0;
      const value = balance * usd;
      const pnl = symbol === 'GRT' && balance > 0 ? (((usd - 0.90) / 0.90) * 100).toFixed(2) : '-';
      console.log(`• ${symbol}: ${balance.toFixed(4)} ($${value.toFixed(2)})  ${pnl !== '-' ? `🧮 PnL: ${pnl}%` : ''}`);
    } catch (err) {
      console.warn(`❌ Failed to fetch balance for ${symbol}: ${err.message}`);
    }
  }

  console.log('\n🧠 Simulating Strategy Score (Fake GRT Prices):');
  const candles = [0.081, 0.083, 0.086, 0.088, 0.091];
  const { score, signals } = strategy.score(candles);
  console.log(`📈 Strategy score: ${score} | Signals: ${signals.join(', ') || '-'}`);

  console.log('\n🧪 Simulating Buy (GRT):');
  try {
    const buyResult = await trade.buy('GRT', { simulate: true, dryRun: true });
    console.log(buyResult);
  } catch (err) {
    console.log(`❌ Buy test failed: ${err.message}`);
  }

  console.log('\n🧪 Simulating Sell (DYDX):');
  try {
    const sellResult = await sellToken('DYDX');
    console.log(sellResult);
  } catch (err) {
    console.log(`❌ Sell test failed: ${err.message}`);
  }

  console.log('\n📋 Summary:');
  console.log(`• ETH Balance: ${eth}`);
  console.log(`• WETH Balance: ${weth}`);
  console.log('• Prices:', prices);

  console.log('\n✅ Test complete.\n');
}

main().catch(console.error);
