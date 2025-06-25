const fs = require('fs');
const path = require('path');
const { ethers } = require('ethers');
const logger = require('./logger');

const provider = new ethers.JsonRpcProvider(process.env.ARB_RPC_URL);
const feedAbi = ['function latestAnswer() view returns (int256)'];

async function validate(force = false) {
  const tokensFile = path.join(__dirname, 'tokens.json');
  if (!force && fs.existsSync(tokensFile)) {
    try {
      return JSON.parse(fs.readFileSync(tokensFile));
    } catch {
      // continue to rebuild file
    }
  }

  const rawFile = path.join(__dirname, 'rawTokens.json');
  let raw = [];
  try {
    raw = JSON.parse(fs.readFileSync(rawFile));
  } catch (err) {
    logger.error(`Failed to read raw token list: ${err.message}`);
    return [];
  }

  const valid = [];
  for (const t of raw) {
    try {
      const address = ethers.getAddress(t.address);
      const feed = ethers.getAddress(t.feed);
      const contract = new ethers.Contract(feed, feedAbi, provider);
      const price = await contract.latestAnswer();
      if (!price || price === 0n) {
        logger.log(`Skip ${t.symbol}: feed returned zero`);
        continue;
      }
      valid.push({ symbol: t.symbol, address, feed });
    } catch (err) {
      logger.log(`Skip ${t.symbol}: ${err.message}`);
    }
  }

  try {
    fs.writeFileSync(tokensFile, JSON.stringify(valid, null, 2));
    logger.log(`Saved ${valid.length} validated tokens`);
  } catch (err) {
    logger.error(`Failed to write tokens.json: ${err.message}`);
  }

  return valid;
}

module.exports = validate;
