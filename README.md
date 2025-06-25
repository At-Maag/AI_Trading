# AI Trading

This repository contains an experimental crypto trading bot implemented in Node.js. The `ai-trading-bot` folder provides a basic scaffolding with placeholder logic for price feeds, technical indicators, strategy, risk management and a small dashboard.

The project uses `ethers` to interact with the Arbitrum network and `technicalindicators` for trading signals. Copy `ai-trading-bot/.env.example` to `ai-trading-bot/.env` and fill in your wallet `PRIVATE_KEY`. You can also override the default RPC endpoint by setting `ARB_RPC_URL`. Set `PAPER=true` in the `.env` file to run in paper trading mode or `false` to place real trades. The `.env` file is excluded from version control so your credentials remain private.

If the bot cannot download the latest token lists due to network restrictions, it
falls back to a small built-in list containing WETH, USDC, USDT, DAI and WBTC so
that basic testing can proceed offline.
