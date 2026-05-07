import { Router } from "express";
import { describe, listModels } from "../lm/models";
import { classifyError, sendError } from "../util/errors";
import type { ActivityRecorder } from "./types";

export function modelsRouter(deps: { onRequest?: ActivityRecorder }): Router {
  const r = Router();

  r.get("/models", async (req, res) => {
    const startedAt = Date.now();
    try {
      if (!req.header("x-api-key")) {
        sendError(res, 401, "authentication_error", "Missing x-api-key header.");
        return;
      }

      const models = await listModels();
      const data = models.map((m) => ({
        id: m.id,
        type: "model" as const,
        display_name: describe(m).display_name,
        created_at: null,
      }));
      res.json({
        data,
        first_id: data[0]?.id ?? null,
        last_id: data[data.length - 1]?.id ?? null,
        has_more: false,
      });
    } catch (e) {
      const { status, type, message } = classifyError(e);
      sendError(res, status, type, message);
    } finally {
      deps.onRequest?.({
        timestamp: startedAt,
        method: "GET",
        path: "/v1/models",
        status: res.statusCode,
        durationMs: Date.now() - startedAt,
      });
    }
  });

  return r;
}
