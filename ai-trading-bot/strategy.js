const ti = require('technicalindicators');

// Analyze price history and return trade signal information
// symbol - string like "ETH"
// prices - array of closing prices (oldest to newest)
function analyze(symbol, prices) {
  if (!Array.isArray(prices) || prices.length < 30) {
    console.error('Not enough price data provided to strategy');
    return null;
  }

  // calculate indicators
  const rsi = ti.RSI.calculate({ values: prices, period: 14 }).slice(-1)[0];
  const macd = ti.MACD.calculate({
    values: prices,
    fastPeriod: 12,
    slowPeriod: 26,
    signalPeriod: 9,
    SimpleMAOscillator: false,
    SimpleMASignal: false
  }).slice(-1)[0];

  const boll = ti.BollingerBands.calculate({
    period: 20,
    values: prices,
    stdDev: 2
  }).slice(-1)[0];

  const close = prices[prices.length - 1];
  const histogram = macd ? macd.histogram : undefined;

  let bbPosition = 'inside';
  if (boll) {
    if (close > boll.upper) bbPosition = 'above';
    else if (close < boll.lower) bbPosition = 'below';
  }

  console.log(`\ud83d\udcc8 ${symbol} \u2192 RSI: ${rsi?.toFixed(1)}, MACD: ${histogram?.toFixed(4)}, Bollinger: ${bbPosition}`);

  if (rsi !== undefined && histogram !== undefined && boll) {
    if (rsi < 30 && histogram > 0 && close < boll.lower) {
      return {
        action: 'BUY',
        confidence: 8,
        reason: 'RSI<30, BB below, MACD turning up'
      };
    }
    if (rsi > 70 && histogram < 0 && close > boll.upper) {
      return {
        action: 'SELL',
        confidence: 8,
        reason: 'RSI>70, BB above, MACD turning down'
      };
    }
  }

  return null;
}

module.exports = { analyze };
