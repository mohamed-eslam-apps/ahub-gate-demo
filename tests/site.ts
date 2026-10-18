// Automation Hub strips the trailing slash from an environment's base URL
// (".../ahub-gate-demo/test"), and a relative goto("./") against that resolves
// one folder too high. Always navigate from an explicit folder URL instead.
export const siteRoot = (baseURL: string | undefined): string =>
  (baseURL ?? "http://localhost:4173").replace(/\/?$/, "/");
