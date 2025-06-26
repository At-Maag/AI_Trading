# AI Trading

This repository contains an experimental crypto trading bot implemented in Node.js. The `ai-trading-bot` folder provides a basic scaffolding with placeholder logic for price feeds, technical indicators, strategy, risk management and a small dashboard.

The project uses `ethers` to interact with the Arbitrum network and `technicalindicators` for trading signals. Copy `ai-trading-bot/.env.example` to `ai-trading-bot/.env` and fill in your wallet `PRIVATE_KEY`. You can also override the default RPC endpoint by setting `ARB_RPC_URL`. Set `PAPER=true` in the `.env` file to run in paper trading mode or `false` to place real trades. The `.env` file is excluded from version control so your credentials remain private.

Token validation is completely local. Static lists under the `data/` folder provide token addresses and Chainlink price feeds. Run `node validator.js` to generate `tokens.json` before starting the bot.
