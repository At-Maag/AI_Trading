const { RSI, MACD, SMA, EMA } = require('technicalindicators');
const DEBUG_TOKENS = process.env.DEBUG_TOKENS === 'true';
const debug_pairs = process.env.DEBUG_PAIRS === 'true';

// --- Indicator helpers ----------------------------------------------------
function normalizeKeys(obj = {}) {
  const map = {};
  for (const [k, v] of Object.entries(obj)) {
    map[k.toLowerCase()] = v;
  }
  return {
    macd: map.macd || map.MACD || map['macd'],
    rsi: map.rsi,
    ema20: map.ema20,
    ema60: map.ema60
  };
}

function computeIndicators(candles) {
  const closes = candles.map(c => typeof c === 'number' ? c : c.close);
  const rsi = RSI.calculate({ values: closes, period: 14 }).pop();
  const macdArr = MACD.calculate({
    values: closes,
    fastPeriod: 12,
    slowPeriod: 26,
    signalPeriod: 9,
    SimpleMAOscillator: false,
    SimpleMASignal: false
  });
  const macd = macdArr[macdArr.length - 1];
  const macdPrev = macdArr[macdArr.length - 2];
  const ema20 = EMA.calculate({ period: 20, values: closes }).pop();
  const ema60 = EMA.calculate({ period: 60, values: closes }).pop();
  return { macd, macdPrev, rsi, ema20, ema60 };
}

function computeIndicatorsSafe(candles) {
  try {
    const ind = computeIndicators(candles);
    const n = { ...normalizeKeys(ind), macdPrev: ind.macdPrev };
    if (!n.macd || !n.macdPrev || n.rsi == null || n.ema20 == null || n.ema60 == null) {
      return null;
    }
    return n;
  } catch {
    return null;
  }
}

// Calculate weighted score of technical signals for a set of closing prices
function getTradeSignals(candles) {
  if (!Array.isArray(candles) || candles.length < 60) {
    return { signal: null, reason: 'not_enough_candles' };
  }

  const indicators = computeIndicatorsSafe(candles);
  if (!indicators) {
    return { signal: null, reason: 'indicator_error' };
  }
  const { macd, macdPrev, rsi, ema20, ema60 } = indicators;
  if ([macd, macdPrev, rsi, ema20, ema60].some(v => v == null || Number.isNaN(v))) {
    return { signal: null, reason: 'invalid_indicator_values' };
  }

  const prices = candles.map(c => typeof c === 'number' ? c : c.close);
  const price = prices[prices.length - 1];
  const prevPrice = prices[prices.length - 2];
  const macdHist = (macd.MACD - macd.signal) || 0;
  const prevHist = (macdPrev.MACD - macdPrev.signal) || 0;

  const lookback = prices.length >= 6 ? prices[prices.length - 6] : prices[0];
  const momentum = lookback ? (price - lookback) / lookback : 0;

  let score = 0;
  const prevRsi = rsi; // we only have latest, so reuse
  if (rsi < 30) score += 1;
  if (prevRsi < 30 && rsi >= 30) score += 2;
  const smaVals = SMA.calculate({ period: 20, values: prices });
  const sma = smaVals[smaVals.length - 1];
  const prevSma = smaVals[smaVals.length - 2];
  const smaCross = prevPrice <= prevSma && price > sma;
  if (smaCross) score += 2;
  const macdUp = macdHist > prevHist || macdHist > 0;
  if (macdUp) score += 2;
  if (momentum > 0.5) score += 1;

  return {
    signal: score >= 3 ? 'BUY' : null,
    reason: score >= 3 ? 'signal_score' : 'score_below_threshold',
    indicators: { rsi, macd: macd.MACD, signal: macd.signal, ema20, ema60 },
    macdHist: Number(macdHist.toFixed ? macdHist.toFixed(6) : macdHist),
    smaAbove: price > sma,
    momentum: Number(momentum.toFixed ? momentum.toFixed(6) : momentum),
    signalScore: score
  };
}

// Calculate the most recent RSI value from an array of closing prices
function latestRsi(closing) {
  const values = RSI.calculate({ values: closing, period: 14 });
  return values[values.length - 1];
}

// AI-Enhanced Momentum Breakout strategy
// prices - array of closing prices (oldest to newest)
function analyze(symbol, prices) {
  if (!Array.isArray(prices) || prices.length < 5) {
    if (DEBUG_TOKENS) {
      console.log(`❌ Insufficient price history for ${symbol}`);
    }
    return null;
  }

  const rsiVals = RSI.calculate({ values: prices, period: 14 });
  const macdVals = MACD.calculate({
    values: prices,
    fastPeriod: 12,
    slowPeriod: 26,
    signalPeriod: 9,
    SimpleMAOscillator: false,
    SimpleMASignal: false
  });
  const sma5 = SMA.calculate({ period: 5, values: prices });
  const sma20 = SMA.calculate({ period: 20, values: prices });

  const signals = [];

  const rsiCurrent = latestRsi(prices);
  const rsiDropped = rsiVals.slice(-5).some(v => v < 30);
  if (rsiDropped && rsiCurrent > 40) {
    signals.push('RSI bounce');
  }

  // --- Enhanced aggressive logic ---
  const recentHigh = Math.max(...prices.slice(-5));
  const currentPrice = prices[prices.length - 1];
  if (currentPrice > recentHigh * 1.01) {
    signals.push('Breakout spike');
  }

  if (currentPrice > sma5[sma5.length - 1]) {
    signals.push('Price above SMA5');
  }

  if (rsiCurrent >= 40 && rsiCurrent <= 60) {
    signals.push('RSI in momentum zone');
  }

  if (macdVals.length >= 2) {
    const prev = macdVals[macdVals.length - 2];
    const curr = macdVals[macdVals.length - 1];
    if (prev.MACD <= prev.signal && curr.MACD > curr.signal) {
      signals.push('MACD bullish crossover');
    }
  }

  if (sma5.length >= 2 && sma20.length >= 2) {
    const prevCross = sma5[sma5.length - 2] <= sma20[sma20.length - 2];
    const currCross = sma5[sma5.length - 1] > sma20[sma20.length - 1];
    if (prevCross && currCross) {
      signals.push('SMA crossover');
    }
  }

  const aggressive = process.env.AGGRESSIVE === 'true';
  console.log(`[STRATEGY] ${symbol} => signals:`, signals);
  if (DEBUG_TOKENS) {
    if (signals.length) {
      console.log(`✅ SIGNAL MATCH: ${symbol}: [${signals.join(', ')}]`);
    } else {
      console.log(`❌ No signal match for ${symbol}: signals.length = 0`);
    }
  }

  if ((aggressive && signals.length >= 1) || signals.length >= 2) {
    return { action: 'BUY', confidence: signals.length, reasons: signals };
  }

  if (rsiCurrent > 70 || (macdVals.length >= 2 && macdVals[macdVals.length - 1].MACD < macdVals[macdVals.length - 1].signal)) {
    return { action: 'SELL', confidence: 1, reasons: ['Overbought or MACD bearish'] };
  }

  return null;
}

function shouldBuy(symbol, prices) {
  const signals = getTradeSignals(prices);
  return signals.signalScore >= 3;
}

function shouldSell(symbol, prices) {
  const res = analyze(symbol, prices);
  return res && res.action === 'SELL';
}

function score(prices) {
  if (!Array.isArray(prices) || prices.length < 20) {
    return { score: 0, signals: [] };
  }

  const rsiVals = RSI.calculate({ values: prices, period: 14 });
  const sma5 = SMA.calculate({ period: 5, values: prices });
  const sma20 = SMA.calculate({ period: 20, values: prices });

  const rsiCurrent = rsiVals[rsiVals.length - 1];
  const signals = [];

  if (rsiCurrent >= 40 && rsiCurrent <= 60) {
    signals.push('RSI in momentum zone');
  }

  const currentPrice = prices[prices.length - 1];
  if (sma5.length && currentPrice > sma5[sma5.length - 1]) {
    signals.push('Price above SMA');
  }

  const rsiDropped = rsiVals.slice(-5).some(v => v < 30);
  let crossover = false;
  if (sma5.length >= 2 && sma20.length >= 2) {
    const prevCross = sma5[sma5.length - 2] <= sma20[sma20.length - 2];
    const currCross = sma5[sma5.length - 1] > sma20[sma20.length - 1];
    crossover = prevCross && currCross;
  }
  if (rsiDropped && rsiCurrent > 40 || crossover) {
    signals.push('RSI bounce/SMA crossover');
  }

  return { score: signals.length, signals };
}

module.exports = { analyze, shouldBuy, shouldSell, latestRsi, score, getTradeSignals };
