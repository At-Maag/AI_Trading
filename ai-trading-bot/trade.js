const { ethers } = require('ethers');
const config = require('./config');
require('dotenv').config();

const routerAbi = [
  'function swapExactETHForTokens(uint amountOutMin, address[] calldata path, address to, uint deadline) payable returns (uint[] memory amounts)',
  'function swapExactTokensForETH(uint amountIn, uint amountOutMin, address[] calldata path, address to, uint deadline) returns (uint[] memory amounts)'
];

const provider = new ethers.InfuraProvider('mainnet', process.env.INFURA_API_KEY);
const wallet = new ethers.Wallet(process.env.PRIVATE_KEY, provider);
const router = new ethers.Contract('0x5C69bEe701ef814a2B6a3EDD4B1652CB9cc5aA6f', routerAbi, wallet); // placeholder address

async function buy(amountEth, path) {
  const tx = await router.swapExactETHForTokens(
    0,
    path,
    wallet.address,
    Math.floor(Date.now() / 1000) + 60 * 10,
    { value: ethers.parseEther(amountEth.toString()) }
  );
  return tx.wait();
}

async function sell(amountToken, path) {
  const tx = await router.swapExactTokensForETH(
    ethers.parseUnits(amountToken.toString(), 18),
    0,
    path,
    wallet.address,
    Math.floor(Date.now() / 1000) + 60 * 10
  );
  return tx.wait();
}

module.exports = { buy, sell };
