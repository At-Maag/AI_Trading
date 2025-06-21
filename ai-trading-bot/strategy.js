const ti = require('technicalindicators');

// AI-Enhanced Momentum Breakout strategy
// prices - array of closing prices (oldest to newest)
function analyze(symbol, prices) {
  if (!Array.isArray(prices) || prices.length < 14) {
    console.error('Not enough price data provided to strategy');
    return null;
  }

  const rsiVals = ti.RSI.calculate({ values: prices, period: 14 });
  const macdVals = ti.MACD.calculate({
    values: prices,
    fastPeriod: 12,
    slowPeriod: 26,
    signalPeriod: 9,
    SimpleMAOscillator: false,
    SimpleMASignal: false
  });
  const sma5 = ti.SMA.calculate({ period: 5, values: prices });
  const sma20 = ti.SMA.calculate({ period: 20, values: prices });

  const signals = [];

  const rsiCurrent = rsiVals[rsiVals.length - 1];
  const rsiDropped = rsiVals.slice(-5).some(v => v < 30);
  if (rsiDropped && rsiCurrent > 40) {
    signals.push('RSI bounce');
  }

  if (macdVals.length >= 2) {
    const prev = macdVals[macdVals.length - 2];
    const curr = macdVals[macdVals.length - 1];
    if (prev.MACD <= prev.signal && curr.MACD > curr.signal) {
      signals.push('MACD bullish');
    }
  }

  if (sma5.length >= 2 && sma20.length >= 2) {
    const prevCross = sma5[sma5.length - 2] <= sma20[sma20.length - 2];
    const currCross = sma5[sma5.length - 1] > sma20[sma20.length - 1];
    if (prevCross && currCross) {
      signals.push('SMA crossover');
    }
  }

  console.log(`\uD83D\uDD14 ${symbol} Signals: ${signals.join(', ')}`);

  if (signals.length >= 3) {
    console.log(`\u2705 BUY trigger for ${symbol}`);
    return { action: 'BUY', confidence: signals.length, reasons: signals };
  }

  return null;
}

function shouldBuy(symbol, prices) {
  const res = analyze(symbol, prices);
  return res && res.action === 'BUY';
}

function shouldSell(symbol, prices) {
  const res = analyze(symbol, prices);
  return res && res.action === 'SELL';
}

module.exports = { analyze, shouldBuy, shouldSell };
