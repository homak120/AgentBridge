import express, { type Application, type NextFunction, type Request, type Response } from "express";
import { messagesRouter } from "./routes/messages";
import { modelsRouter } from "./routes/models";
import type { RouteDeps } from "./routes/types";
import { classifyError, sendError } from "./util/errors";

export function buildApp(deps: RouteDeps): Application {
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "10mb" }));

  app.use("/v1", modelsRouter(deps));
  app.use("/v1", messagesRouter(deps));

  // 404 for anything else, in the Anthropic envelope.
  app.use((req, res) => {
    sendError(res, 404, "not_found_error", `Unknown route: ${req.method} ${req.path}`);
  });

  // Final error handler: never leak Express defaults.
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (res.headersSent) return;
    const { status, type, message } = classifyError(err);
    sendError(res, status, type, message);
  });

  return app;
}
