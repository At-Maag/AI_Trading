const { ethers } = require('ethers');
const fs = require('fs');
const path = require('path');
const config = require('./config');
require('dotenv').config();

const routerAbi = [
  'function swapExactETHForTokens(uint amountOutMin, address[] calldata path, address to, uint deadline) payable returns (uint[] memory amounts)',
  'function swapExactTokensForETH(uint amountIn, uint amountOutMin, address[] calldata path, address to, uint deadline) returns (uint[] memory amounts)'
];

const provider = new ethers.InfuraProvider('mainnet', process.env.INFURA_API_KEY);
const wallet = new ethers.Wallet(process.env.PRIVATE_KEY, provider);
const router = new ethers.Contract('0x5C69bEe701ef814a2B6a3EDD4B1652CB9cc5aA6f', routerAbi, wallet); // placeholder address

const errorLogPath = path.join(__dirname, '..', 'logs', 'error.log');

function logError(err) {
  try { fs.mkdirSync(path.dirname(errorLogPath), { recursive: true }); } catch {}
  const ts = new Date().toISOString();
  const msg = err instanceof Error ? err.stack || err.message : err;
  fs.appendFileSync(errorLogPath, `[${ts}] ${msg}\n`);
  console.error(msg);
}

const logPath = path.join(__dirname, '..', 'data', 'trade-log.json');

function appendLog(entry) {
  try { fs.mkdirSync(path.dirname(logPath), { recursive: true }); } catch {}
  let data = [];
  try { data = JSON.parse(fs.readFileSync(logPath)); } catch {}
  data.push(entry);
  fs.writeFileSync(logPath, JSON.stringify(data, null, 2));
}

async function gasOkay() {
  const feeData = await provider.getFeeData();
  const gasPrice = feeData.gasPrice || ethers.parseUnits('0', 'gwei');
  if (gasPrice > ethers.parseUnits(config.GAS_LIMIT_GWEI.toString(), 'gwei')) {
    const gwei = Number(ethers.formatUnits(gasPrice, 'gwei')).toFixed(1);
    console.log(`\u26FD Gas ${gwei} gwei exceeds limit`);
    logError(`Gas price ${gwei} gwei exceeds limit`);
    appendLog({ time: new Date().toISOString(), action: 'SKIP', reason: 'Gas high', gas: gwei });
    return false;
  }
  return true;
}

async function buy(amountEth, path, token) {
  if (token && ['ETH', 'WETH'].includes(token.toUpperCase())) {
    console.log('\u26a0\ufe0f Skipping ETH to ETH trade');
    return null;
  }
  if (!await gasOkay()) return null;
  try {
    const tx = await router.swapExactETHForTokens(
      0,
      path,
      wallet.address,
      Math.floor(Date.now() / 1000) + 60 * 10,
      { value: ethers.parseEther(amountEth.toString()) }
    );
    const receipt = await tx.wait();
    appendLog({ time: new Date().toISOString(), action: 'BUY', token, amountEth, tx: tx.hash });
    return receipt;
  } catch (err) {
    logError(`Failed to trade ETH \u2192 ${token} | ${err.stack || err}`);
    throw err;
  }
}

async function sell(amountToken, path, token) {
  if (token && ['ETH', 'WETH'].includes(token.toUpperCase())) {
    console.log('\u26a0\ufe0f Skipping ETH to ETH trade');
    return null;
  }
  if (!await gasOkay()) return null;
  try {
    const tx = await router.swapExactTokensForETH(
      ethers.parseUnits(amountToken.toString(), 18),
      0,
      path,
      wallet.address,
      Math.floor(Date.now() / 1000) + 60 * 10
    );
    const receipt = await tx.wait();
    appendLog({ time: new Date().toISOString(), action: 'SELL', token, amountToken, tx: tx.hash });
    return receipt;
  } catch (err) {
    logError(`Failed to trade ${token} \u2192 ETH | ${err.stack || err}`);
    throw err;
  }
}

async function getEthBalance() {
  const bal = await provider.getBalance(wallet.address);
  return Number(ethers.formatEther(bal));
}

module.exports = { buy, sell, getEthBalance };
