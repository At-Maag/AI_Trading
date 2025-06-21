module.exports = {
  SLIPPAGE: 0.005, // 0.5%
  coins: [
    'ETH',      // Ethereum
    'LINK',     // Chainlink
    'UNI',      // Uniswap
    'ARB',      // Arbitrum
    'MATIC',    // Polygon
    'WBTC',     // Wrapped Bitcoin
    'AAVE',     // Aave
    'COMP',     // Compound
    'SNX',      // Synthetix
    'SUSHI',    // SushiSwap
    'LDO',      // Lido DAO
    'MKR',      // Maker
    'CRV',      // Curve DAO
    'GRT',      // The Graph
    'ENS',      // Ethereum Name Service
    '1INCH',    // 1inch
    'DYDX',     // dYdX
    'BAL',      // Balancer
    'BNT',      // Bancor
    'REN',      // Ren Protocol
    'OCEAN',    // Ocean Protocol
    'BAND',     // Band Protocol
    'RLC',      // iExec RLC
    'AMPL',     // Ampleforth
    'STORJ'     // Storj
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
  TRADE_ALLOCATION: 0.22
};
