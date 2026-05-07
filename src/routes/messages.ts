import { randomBytes } from "node:crypto";
import { Router } from "express";
import * as vscode from "vscode";
import { collectText } from "../converter/responseFromLm";
import { parseRequestBody } from "../converter/parse";
import { requestToLm } from "../converter/requestToLm";
import { resolveModel } from "../lm/models";
import type { MessagesResponse } from "../converter/types";
import { classifyError, HttpError, sendError } from "../util/errors";
import type { RouteDeps } from "./types";

export function messagesRouter(deps: RouteDeps): Router {
  const r = Router();

  r.post("/messages", async (req, res) => {
    const startedAt = Date.now();
    let modelId: string | undefined;
    let cts: vscode.CancellationTokenSource | undefined;

    try {
      if (!req.header("x-api-key")) {
        throw new HttpError(401, "authentication_error", "Missing x-api-key header.");
      }

      const body = parseRequestBody(req.body);
      modelId = body.model;

      if (body.stream) {
        throw new HttpError(
          400,
          "invalid_request_error",
          "Streaming is not implemented in this build (Phase 2). Set stream:false.",
        );
      }

      const model = await resolveModel(body.model, deps.defaultModel());
      if (!model) {
        throw new HttpError(
          404,
          "not_found_error",
          `Unknown model "${body.model}". Pick a Copilot model id or set agentbridge.defaultModel.`,
        );
      }

      const { messages, options } = requestToLm(body);

      cts = new vscode.CancellationTokenSource();
      req.on("close", () => cts?.cancel());

      const response = await model.sendRequest(messages, options, cts.token);
      const text = await collectText(response.stream);

      const out: MessagesResponse = {
        id: makeMessageId(),
        type: "message",
        role: "assistant",
        model: model.id,
        content: text.length > 0 ? [{ type: "text", text }] : [],
        stop_reason: "end_turn",
        stop_sequence: null,
        usage: { input_tokens: 0, output_tokens: 0 },
      };
      res.json(out);
    } catch (e) {
      const { status, type, message } = classifyError(e);
      if (!res.headersSent) {
        sendError(res, status, type, message);
      }
    } finally {
      cts?.dispose();
      deps.onRequest?.({
        timestamp: startedAt,
        method: "POST",
        path: "/v1/messages",
        status: res.statusCode,
        durationMs: Date.now() - startedAt,
        model: modelId,
      });
    }
  });

  return r;
}

function makeMessageId(): string {
  return "msg_" + randomBytes(12).toString("hex");
}
