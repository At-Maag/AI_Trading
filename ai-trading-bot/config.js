module.exports = {
  SLIPPAGE: 0.01, // 1% slippage tolerance
  // Start with a minimal list. Additional tokens are loaded dynamically
  // from the CoinGecko API at runtime via top25.js
  coins: [
    // Use WETH exclusively as the base asset
    'WETH'
  ],
  RSI_PERIOD: 14,
  MACD_FAST: 12,
  MACD_SLOW: 26,
  MACD_SIGNAL: 9,
  BOLLINGER_PERIOD: 20,
  STOP_LOSS: 0.04, // 4%
  TAKE_PROFIT: 0.08, // 8%
  TRAILING_STOP: 0.02,
  GAS_LIMIT_GWEI: 80,
  TRADE_ALLOCATION: 0.15,
  prettyLogs: true
};
