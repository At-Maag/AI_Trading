# AI Trading

This repository contains an experimental crypto trading bot implemented in Node.js. The `ai-trading-bot` folder provides a basic scaffolding with placeholder logic for price feeds, technical indicators, strategy, risk management and a small dashboard.

The project uses `ethers` to interact with Ethereum mainnet and `technicalindicators` for trading signals. Copy `ai-trading-bot/.env.example` to `ai-trading-bot/.env` and fill in your Infura key and wallet private key. Set `PAPER=true` in the `.env` file to run in paper trading mode or `false` to place real trades. The `.env` file is excluded from version control so your credentials remain private.
