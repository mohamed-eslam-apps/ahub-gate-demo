const count = document.querySelector('[data-testid="count"]');
let items = 0;
document.querySelector('[data-testid="add"]').addEventListener("click", () => {
  items += 1;
  count.textContent = String(items);
});
document.querySelector('[data-testid="clear"]').addEventListener("click", () => {
  items = 0;
  count.textContent = "0";
});

const form = document.querySelector('[data-testid="newsletter"]');
const status = document.querySelector('[data-testid="form-status"]');
form.addEventListener("submit", (e) => {
  e.preventDefault();
  const email = form.email.value.trim();
  const valid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  status.textContent = valid ? "Subscribed!" : "Please enter a valid email.";
  status.className = valid ? "ok" : "error";
});

// Promo codes: one code, 10% off. No automated test covers this yet.
const promo = document.querySelector('[data-testid="promo"]');
const promoStatus = document.querySelector('[data-testid="promo-status"]');
promo.addEventListener("submit", (e) => {
  e.preventDefault();
  const valid = promo.code.value.trim().toUpperCase() === "GATE10";
  promoStatus.textContent = valid ? "10% off applied." : "That code is not valid.";
  promoStatus.className = valid ? "ok" : "error";
});

fetch(`version.json?ts=${Date.now()}`)
  .then((r) => r.json())
  .then((v) => {
    document.querySelector('[data-testid="version"]').textContent = v.commitSha.slice(0, 7);
  })
  .catch(() => {
    document.querySelector('[data-testid="version"]').textContent = "unknown";
  });
