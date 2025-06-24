try { require('dotenv').config(); } catch { console.warn('⚠️ dotenv not found'); }

const { getValidTokens } = require('./top25');

(async () => {
  const tokens = await getValidTokens();
  console.log(`✅ Loaded ${tokens.length}/${process.env.TOKEN_COUNT || 50} tokens:`);
  for (const t of tokens) {
    console.log(`• ${t.symbol} | score: ${t.score} | address: ${t.address}`);
  }
})();

