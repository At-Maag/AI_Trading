const { ethers } = require("ethers");
require("dotenv").config();

const provider = new ethers.JsonRpcProvider(process.env.ARB_RPC_URL);

(async () => {
  try {
    const block = await provider.getBlockNumber();
    console.log("✅ Arbitrum block number:", block);
  } catch (err) {
    console.error("❌ Failed to connect:", err.message);
  }
})();
