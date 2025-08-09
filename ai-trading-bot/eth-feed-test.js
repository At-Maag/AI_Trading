const { ethers } = require("ethers");
require("dotenv").config();

const provider = new ethers.JsonRpcProvider(process.env.ARB_RPC_URL);
const registryAddress = "0x47Fb2585D2C56Fe188D0E6ec628a38b74fCeeeDf";
const registryAbi = [
  "function getFeed(address base, address quote) external view returns (address aggregator)"
];
const aggregatorAbi = [
  "function latestRoundData() view returns (uint80, int256, uint256, uint256, uint80)"
];

// Arbitrum ETH address + USD feed ID
const token = "0x82af49447d8a07e3bd95bd0d56f35241523fbab1";
const USD = "0x0000000000000000000000000000000000000348";

(async () => {
  try {
    const registry = new ethers.Contract(registryAddress, registryAbi, provider);
    const feedAddress = await registry.getFeed(token, USD);
    console.log("✅ Feed Address:", feedAddress);

    const feed = new ethers.Contract(feedAddress, aggregatorAbi, provider);
    const [, price] = await feed.latestRoundData();
    console.log("✅ ETH/USD Price:", Number(price) / 1e8);
  } catch (err) {
    console.error("❌ Error:", err.message);
  }
})();
