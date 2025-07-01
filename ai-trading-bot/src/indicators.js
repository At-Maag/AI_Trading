const ti = require('technicalindicators');

function rsi(values, period) {
  return ti.RSI.calculate({ values, period });
}

function macd(values) {
  return ti.MACD.calculate({
    values,
    fastPeriod: 12,
    slowPeriod: 26,
    signalPeriod: 9,
    SimpleMAOscillator: false,
    SimpleMASignal: false
  });
}

function bollinger(values, period) {
  return ti.BollingerBands.calculate({ period, values, stdDev: 2 });
}

module.exports = { rsi, macd, bollinger };
