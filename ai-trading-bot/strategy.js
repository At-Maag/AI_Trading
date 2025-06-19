const indicators = require('./indicators');
const config = require('./config');

function scoreSignals(history) {
  const closing = history.map(c => c.close);
  const rsiValues = indicators.rsi(closing, config.RSI_PERIOD).slice(-1)[0];
  const macdValues = indicators.macd(closing).slice(-1)[0];
  const boll = indicators.bollinger(closing, config.BOLLINGER_PERIOD).slice(-1)[0];
  let score = 0;
  if (rsiValues < 30) score += 1; // oversold
  if (rsiValues > 70) score -= 1; // overbought
  if (macdValues && macdValues.MACD > macdValues.signal) score += 1;
  if (macdValues && macdValues.MACD < macdValues.signal) score -= 1;
  if (boll && closing[closing.length - 1] < boll.lower) score += 1;
  if (boll && closing[closing.length - 1] > boll.upper) score -= 1;
  return score;
}

function shouldBuy(score) {
  return score > 1;
}

function shouldSell(score) {
  return score < -1;
}

module.exports = { scoreSignals, shouldBuy, shouldSell };
