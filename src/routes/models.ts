import { Router } from "express";
import { clipBody } from "../activity";
import { describe, listModels } from "../lm/models";
import { classifyError, sendError } from "../util/errors";
import type { RouteDeps } from "./types";

export function modelsRouter(deps: RouteDeps): Router {
  const r = Router();

  r.get("/models", async (req, res) => {
    const ctx = deps.recorder.begin("GET", "/v1/models");
    ctx.setRequest(req.headers, clipBody(""));

    try {
      if (!req.header("x-api-key")) {
        sendError(res, 401, "authentication_error", "Missing x-api-key header.");
        ctx.setResponse(
          res.statusCode,
          res.getHeaders(),
          clipBody(
            JSON.stringify(
              { type: "error", error: { type: "authentication_error", message: "Missing x-api-key header." } },
              null,
              2,
            ),
          ),
        );
        return;
      }

      const models = await listModels();
      ctx.mark("upstreamSent");
      const data = models.map((m) => ({
        id: m.id,
        type: "model" as const,
        display_name: describe(m).display_name,
        created_at: null,
      }));
      const out = {
        data,
        first_id: data[0]?.id ?? null,
        last_id: data[data.length - 1]?.id ?? null,
        has_more: false,
      };
      res.json(out);
      ctx.mark("firstByte");
      ctx.setResponse(res.statusCode, res.getHeaders(), clipBody(JSON.stringify(out, null, 2)));
    } catch (e) {
      ctx.setError(e);
      const { status, type, message } = classifyError(e);
      sendError(res, status, type, message);
      ctx.setResponse(
        res.statusCode,
        res.getHeaders(),
        clipBody(JSON.stringify({ type: "error", error: { type, message } }, null, 2)),
      );
    } finally {
      deps.recorder.finish(ctx);
    }
  });

  return r;
}
