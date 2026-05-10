const RELOAD_GUARD_TTL_MS = 30_000;

function reloadGuardKey(): string {
  return `cas_reload_${location.origin}`;
}

function isReloadGuardActive(): boolean {
  const raw = localStorage.getItem(reloadGuardKey());
  if (raw === null) return false;
  const timestamp = Number(raw);
  if (Number.isNaN(timestamp)) return false;
  return Date.now() - timestamp < RELOAD_GUARD_TTL_MS;
}

function setReloadGuard(): void {
  localStorage.setItem(reloadGuardKey(), String(Date.now()));
}

export async function unregisterAllServiceWorkers(): Promise<void> {
  if (!("serviceWorker" in navigator)) return;
  const registrations = await navigator.serviceWorker.getRegistrations();
  await Promise.all(registrations.map((r) => r.unregister()));
}

export function forceVersionReload(): void {
  if (isReloadGuardActive()) return;
  setReloadGuard();
  unregisterAllServiceWorkers().then(() => {
    window.location.reload();
  });
}

export function registerControllerChangeListener(): void {
  if (!("serviceWorker" in navigator)) return;
  let reloading = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (reloading) return;
    reloading = true;
    window.location.reload();
  });
}
