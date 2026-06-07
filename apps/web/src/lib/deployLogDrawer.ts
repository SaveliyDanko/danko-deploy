import type { QueryKey } from "@tanstack/react-query";

export interface DeployLogDrawerState {
  runId: string;
  projectName: string;
  title?: string;
  invalidateKeys?: QueryKey[];
}

const eventName = "dankodeploy:deploy-log-drawer";
let current: DeployLogDrawerState | null = null;

/** Открывает глобальный drawer лога. Он живёт в App и не пропадает при смене вкладок. */
export function openDeployLogDrawer(state: DeployLogDrawerState): void {
  current = state;
  window.dispatchEvent(new CustomEvent<DeployLogDrawerState | null>(eventName, { detail: current }));
}

export function closeDeployLogDrawer(): void {
  current = null;
  window.dispatchEvent(new CustomEvent<DeployLogDrawerState | null>(eventName, { detail: null }));
}

export function getDeployLogDrawerState(): DeployLogDrawerState | null {
  return current;
}

export function subscribeDeployLogDrawer(
  listener: (state: DeployLogDrawerState | null) => void,
): () => void {
  const handler = (event: Event) => {
    listener((event as CustomEvent<DeployLogDrawerState | null>).detail);
  };
  window.addEventListener(eventName, handler);
  return () => window.removeEventListener(eventName, handler);
}
