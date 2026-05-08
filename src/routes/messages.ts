import { randomBytes } from "node:crypto";
import { Router } from "express";
import * as vscode from "vscode";
import { clipBody } from "../activity";
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
    const ctx = deps.recorder.begin("POST", "/v1/messages");
    ctx.setRequest(req.headers, clipBody(safeStringify(req.body)));

    const cts = new vscode.CancellationTokenSource();
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
      ctx.setModel(body.model);
      ctx.mark("bodyParsed");

      const model = await resolveModel(body.model, deps.defaultModel());
      if (!model) {
        throw new HttpError(
          404,
          "not_found_error",
          `Unknown model "${body.model}". Pick a Copilot model id or set agentbridge.defaultModel.`,
        );
      }
      ctx.mark("modelResolved");

      const { messages, options } = requestToLm(body);
      const response = await model.sendRequest(messages, options, cts.token);
      ctx.mark("upstreamSent");

      const messageId = makeMessageId();

      if (body.stream) {
        await streamResponse(res, response.stream, messageId, model.id, ctx);
      } else {
        const { blocks, stopReason } = await collectResponse(response.stream);
        ctx.mark("firstByte");
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
        ctx.setResponse(res.statusCode, res.getHeaders(), clipBody(JSON.stringify(out, null, 2)));
      }
    } catch (e) {
      ctx.setError(e);
      const { status, type, message } = classifyError(e);
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
        const envelope = { type: "error" as const, error: { type, message } };
        sendError(res, status, type, message);
        ctx.setResponse(
          res.statusCode,
          res.getHeaders(),
          clipBody(JSON.stringify(envelope, null, 2)),
        );
      } else {
        ctx.setResponse(res.statusCode, res.getHeaders());
      }
    } finally {
      cts.dispose();
      deps.recorder.finish(ctx);
    }
  });

  return r;
}

async function streamResponse(
  res: import("express").Response,
  stream: AsyncIterable<unknown>,
  messageId: string,
  modelId: string,
  ctx: import("../activity").RecordingContext,
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
        ctx.appendSseChunk(chunk);
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
    ctx.setResponse(res.statusCode, res.getHeaders());
  } catch (e) {
    const { type, message } = classifyError(e);
    writer.error(type, message);
    res.end();
    ctx.setResponse(res.statusCode, res.getHeaders());
  }
}

function makeMessageId(): string {
  return "msg_" + randomBytes(12).toString("hex");
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2) ?? "";
  } catch {
    return String(value);
  }
}
