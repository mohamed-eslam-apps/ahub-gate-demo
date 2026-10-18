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

fetch(`version.json?ts=${Date.now()}`)
  .then((r) => r.json())
  .then((v) => {
    document.querySelector('[data-testid="version"]').textContent = v.commitSha.slice(0, 7);
  })
  .catch(() => {
    document.querySelector('[data-testid="version"]').textContent = "unknown";
  });
