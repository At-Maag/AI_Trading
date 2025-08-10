module.exports = {
  lpFeeIn: 0.0005,
  lpFeeOut: 0.0005,
  slippageFrac: 0.001,
  gasBuffer: 1.15,
  regimes: {
    quiet: { gasUsdUpTo: 5, bufferPct: 0.005, cooldownMs: 30000 },
    normal: { gasUsdUpTo: 15, bufferPct: 0.01, cooldownMs: 60000 },
    busy: { gasUsdUpTo: Infinity, bufferPct: 0.02, cooldownMs: 120000 }
  },
  minPctFloor: 0.003,
  runnerUsd: 50,
  runnerPct: 0.05,
  trailPctByRegime: { quiet: 0.01, normal: 0.015, busy: 0.02 },
  spreadImpactCaps: {
    quiet: { spread: 0.005, impact: 0.005 },
    normal: { spread: 0.01, impact: 0.01 },
    busy: { spread: 0.015, impact: 0.015 }
  },
  minHoldMs: 30000,
  dailyTradesPerTokenCap: 20,
  lossStreakPause: { count: 3, windowMinutes: 30 }
};
