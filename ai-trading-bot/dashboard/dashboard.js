document.addEventListener('DOMContentLoaded', async () => {
  const res = await fetch('../logs/trades.json');
  const trades = await res.json();
  const container = document.getElementById('trades');
  container.innerHTML = trades.map(t => `<div>${t.time}: ${t.side} ${t.amount} ${t.token} @ ${t.price}</div>`).join('');
});
