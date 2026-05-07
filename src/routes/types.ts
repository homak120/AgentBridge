import type { ActivityEntry } from "../serverController";

export type ActivityRecorder = (entry: ActivityEntry) => void;

export interface RouteDeps {
  defaultModel: () => string | null;
  onRequest?: ActivityRecorder;
}
