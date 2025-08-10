const { ethers } = require('ethers');
const config = require('./config/aggressive');

const gasHistory = [];

function pushGasSample(totalUsd) {
  const now = Date.now();
  gasHistory.push({ time: now, totalUsd });
  const cutoff = now - 5 * 60 * 1000;
  while (gasHistory.length && gasHistory[0].time < cutoff) {
    gasHistory.shift();
  }
}

async function estimateSwapGasUsd(router, buyCall, sellCall, gasPriceWei, ethUsd, gasBuffer = config.gasBuffer) {
  const [buyGas, sellGas] = await Promise.all([
    router.estimateGas[buyCall.method](...buyCall.args),
    router.estimateGas[sellCall.method](...sellCall.args)
  ]);
  const gp = ethers.toNumber(gasPriceWei);
  const buyUsd = Number(buyGas) * gp / 1e18 * ethUsd * gasBuffer;
  const sellUsd = Number(sellGas) * gp / 1e18 * ethUsd * gasBuffer;
  const totalUsd = buyUsd + sellUsd;
  pushGasSample(totalUsd);
  return { buyUsd, sellUsd, totalUsd };
}

function gasRegime() {
  if (!gasHistory.length) return 'normal';
  const sorted = gasHistory.map(g => g.totalUsd).sort((a,b)=>a-b);
  const idx = Math.floor(0.7 * (sorted.length - 1));
  const p70 = sorted[idx];
  if (p70 <= config.regimes.quiet.gasUsdUpTo) return 'quiet';
  if (p70 <= config.regimes.normal.gasUsdUpTo) return 'normal';
  return 'busy';
}

function calcMinProfitPct(gasTotals, buySizeUsd) {
  const regime = gasRegime();
  const regCfg = config.regimes[regime];
  const feeFrac = config.lpFeeIn + config.lpFeeOut + config.slippageFrac * 2;
  const gasTotalUsd = gasTotals.totalUsd;
  let minProfitPct = feeFrac + (gasTotalUsd / buySizeUsd) + regCfg.bufferPct;
  if (minProfitPct < config.minPctFloor) minProfitPct = config.minPctFloor;
  return { minProfitPct, regime, feeFrac, gasTotalUsd };
}

function regimeKnobs(regime) {
  const regCfg = config.regimes[regime] || config.regimes.normal;
  return {
    cooldownMs: regCfg.cooldownMs,
    trailPct: config.trailPctByRegime[regime],
    spreadCap: config.spreadImpactCaps[regime].spread,
    impactCap: config.spreadImpactCaps[regime].impact
  };
}

module.exports = {
  estimateSwapGasUsd,
  gasRegime,
  calcMinProfitPct,
  regimeKnobs,
  pushGasSample
};
