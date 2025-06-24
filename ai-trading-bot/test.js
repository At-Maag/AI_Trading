process.env.PAPER = 'true';
process.env.DRY_RUN = 'true';

require('dotenv').config();
const { ethers, getAddress } = require('ethers');
const TOKENS = require('./tokens');
const { getPrices } = require('./datafeeds');
const { getWethBalance } = require('./trade');

const provider = new ethers.JsonRpcProvider('https://arb1.arbitrum.io/rpc');
const wallet = new ethers.Wallet(process.env.PRIVATE_KEY, provider);
const walletAddress = getAddress(wallet.address);

const erc20Abi = [
  'function balanceOf(address) view returns (uint256)'
];

const TOKEN_DECIMALS = {
  ETH: 18,
  WETH: 18
};

function getDecimals(token) {
  const t = (token || '').toUpperCase();
  if (TOKEN_DECIMALS[t]) return TOKEN_DECIMALS[t];
  if (TOKENS[t]) return 18;
  return 6;
}

async function getTokenBalance(tokenAddr, symbol) {
  try {
    const contract = new ethers.Contract(tokenAddr, erc20Abi, provider);
    const bal = await contract.balanceOf(walletAddress);
    return Number(ethers.formatUnits(bal, getDecimals(symbol)));
  } catch (err) {
    console.warn(`Failed to fetch balance for ${symbol}: ${err.message}`);
    return 0;
  }
}

async function main() {
  console.log(`\uD83E\uDDEA Running test at ${new Date().toLocaleTimeString()} (FORCED DRY RUN)`);

  const prices = await getPrices();
  const ethPrice = prices?.eth || 0;

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
    const balance = await getTokenBalance(addr, symbol);
    const value = balance * (prices[symbol.toLowerCase()] || 0);
    console.log(`${symbol}: ${balance.toFixed(4)} ($${value.toFixed(2)})`);
  }

  console.log('\n\uD83D\uDCDA Summary:');
  console.log(`Prices: ${JSON.stringify(prices)}`);
  console.log(`WETH Balance: ${weth}`);
  console.log(`ETH Balance: ${eth}`);

  console.log('\u2705 Test complete.');
}

main().catch(console.error);
