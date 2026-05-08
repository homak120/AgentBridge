import type { ActivityRecorder } from "../activity";

export interface RouteDeps {
  defaultModel: () => string | null;
  recorder: ActivityRecorder;
}
