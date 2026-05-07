import { randomBytes } from "node:crypto";
import { Router } from "express";
import * as vscode from "vscode";
import { parseRequestBody } from "../converter/parse";
import { requestToLm } from "../converter/requestToLm";
import {
  collectResponse,
  processStream,
  type BlockSink,
} from "../converter/responseFromLm";
import { SseWriter } from "../converter/streaming";
import type { MessagesResponse, StopReason } from "../converter/types";
import { resolveModel } from "../lm/models";
import { classifyError, HttpError, sendError } from "../util/errors";
import { log } from "../util/log";
import type { RouteDeps } from "./types";

export function messagesRouter(deps: RouteDeps): Router {
  const r = Router();

  r.post("/messages", async (req, res) => {
    const startedAt = Date.now();
    let modelId: string | undefined;
    const cts = new vscode.CancellationTokenSource();
    // Cancel only on premature client disconnect — `res.on("close")` fires
    // exactly when the connection drops without a complete response.
    // (`req.on("close")` also fires when the request body stream finishes,
    // which would cancel the upstream call immediately.)
    res.on("close", () => {
      if (!res.writableEnded) {
        log("client disconnected mid-request; cancelling upstream");
        cts.cancel();
      }
    });

    try {
      if (!req.header("x-api-key")) {
        throw new HttpError(401, "authentication_error", "Missing x-api-key header.");
      }

      const body = parseRequestBody(req.body);
      modelId = body.model;

      const model = await resolveModel(body.model, deps.defaultModel());
      if (!model) {
        throw new HttpError(
          404,
          "not_found_error",
          `Unknown model "${body.model}". Pick a Copilot model id or set agentbridge.defaultModel.`,
        );
      }

      const { messages, options } = requestToLm(body);
      const response = await model.sendRequest(messages, options, cts.token);

      const messageId = makeMessageId();

      if (body.stream) {
        await streamResponse(res, response.stream, messageId, model.id);
      } else {
        const { blocks, stopReason } = await collectResponse(response.stream);
        const out: MessagesResponse = {
          id: messageId,
          type: "message",
          role: "assistant",
          model: model.id,
          content: blocks,
          stop_reason: stopReason,
          stop_sequence: null,
          usage: { input_tokens: 0, output_tokens: 0 },
        };
        res.json(out);
      }
    } catch (e) {
      const { status, type, message } = classifyError(e);
      // Log the full error to AgentBridge OutputChannel so we can see
      // upstream LanguageModelError details (cause, code) that don't fit
      // in the wire envelope.
      log(
        `POST /v1/messages → ${status} ${type}: ${message}` +
          (e instanceof Error && e.stack ? `\n${e.stack}` : "") +
          (e && typeof e === "object" && "cause" in e
            ? `\n  cause: ${String((e as { cause: unknown }).cause)}`
            : "") +
          (e && typeof e === "object" && "code" in e
            ? `\n  code: ${String((e as { code: unknown }).code)}`
            : ""),
      );
      if (!res.headersSent) {
        sendError(res, status, type, message);
      } else {
        // Headers already out (streaming had started). The stream helper
        // emits an SSE error event before this handler runs; nothing more
        // to do here.
      }
    } finally {
      cts.dispose();
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

async function streamResponse(
  res: import("express").Response,
  stream: AsyncIterable<unknown>,
  messageId: string,
  modelId: string,
): Promise<void> {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  const writer = new SseWriter(
    {
      write: (chunk) => {
        res.write(chunk);
      },
      end: () => {
        res.end();
      },
    },
    messageId,
    modelId,
  );

  writer.messageStart();

  let stopReason: StopReason = "end_turn";
  const sink: BlockSink = {
    openText(index) {
      writer.contentBlockStart(index, { type: "text", text: "" });
    },
    appendText(index, text) {
      writer.contentBlockDelta(index, { type: "text_delta", text });
    },
    closeText(index) {
      writer.contentBlockStop(index);
    },
    toolCall(index, callId, name, input) {
      writer.contentBlockStart(index, { type: "tool_use", id: callId, name, input: {} });
      writer.contentBlockDelta(index, {
        type: "input_json_delta",
        partial_json: JSON.stringify(input ?? {}),
      });
      writer.contentBlockStop(index);
    },
    end(reason) {
      stopReason = reason;
    },
  };

  try {
    await processStream(stream, sink);
    writer.messageDelta(stopReason, 0);
    writer.messageStop();
    res.end();
  } catch (e) {
    const { type, message } = classifyError(e);
    writer.error(type, message);
    res.end();
  }
}

function makeMessageId(): string {
  return "msg_" + randomBytes(12).toString("hex");
}
