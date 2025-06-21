async function loadTrades() {
  try {
    const res = await fetch('../logs/trades.json');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const trades = await res.json();
    const container = document.getElementById('trades');
    container.innerHTML = trades
      .map(t => `<div>${t.time}: ${t.side} ${t.amount} ${t.token} @ ${t.price}</div>`)
      .join('');
  } catch (err) {
    console.error('Failed to load trades:', err);
  }
}

document.addEventListener('DOMContentLoaded', () => {
  loadTrades();
  setInterval(loadTrades, 5000);
});
