function shouldSell(ctx, knobs, targets) {
  const nowHoldMs = ctx.secondsInTrade * 1000;
  if (nowHoldMs < targets.minHoldMs) return { action: null, reason: 'min_hold' };

  if (ctx.armedTrail) {
    const stop = ctx.peakPrice * (1 - knobs.trailPct);
    if (ctx.lastPrice <= stop) return { action: 'SELL', reason: 'trail_stop' };
    return { action: null, reason: 'trail_wait' };
  }

  const minProfitUsd = targets.minProfitPct * ctx.sizeUsd;
  if (ctx.unrealizedUsd >= minProfitUsd && (ctx.emaSlope <= 0 || !ctx.vwapOK)) {
    if (!ctx.partialsSold && ctx.unrealizedUsd / 2 >= minProfitUsd) {
      return { action: 'PARTIAL', reason: 'tp_momentum_fade' };
    }
    return { action: 'SELL', reason: 'tp_momentum_fade' };
  }

  if (ctx.unrealizedUsd >= targets.runnerUsd || ctx.unrealizedPct >= targets.runnerPct) {
    return { action: 'ARM_TRAIL', reason: 'runner' };
  }

  return { action: null, reason: 'hold' };
}

module.exports = shouldSell;
