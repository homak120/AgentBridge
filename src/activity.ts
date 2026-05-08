import { randomBytes } from "node:crypto";
import type { IncomingHttpHeaders, OutgoingHttpHeaders } from "node:http";
import { EventEmitter } from "vscode";
import { classifyError } from "./util/errors";

// Public summary delivered to the sidebar list.
export interface ActivityEntry {
  id: string;
  timestamp: number;
  method: string;
  path: string;
  status: number;
  durationMs: number;
  model?: string;
}

export interface RequestRecord {
  id: string;
  timestamp: number;
  method: string;
  path: string;
  status: number;
  model?: string;

  request: {
    headers: Record<string, string>;
    bodyText: string;
    bodyBytes: number;
    truncated: boolean;
  };

  response: {
    statusCode: number;
    headers: Record<string, string>;
    bodyText?: string;
    bodyBytes: number;
    truncated: boolean;
    sseChunks?: string[];
  };

  timing: {
    receivedAt: number;
    bodyParsedAt?: number;
    modelResolvedAt?: number;
    upstreamSentAt?: number;
    firstByteAt?: number;
    lastByteAt: number;
    totalMs: number;
  };

  error?: {
    type: string;
    message: string;
    stack?: string;
  };
}

const DEFAULT_CAPACITY = 50;
const DEFAULT_BODY_CAP_BYTES = 256 * 1024;

// Headers whose values would leak credentials into the detail panel
// even though we discard them at validation (decision D3).
const REDACTED_HEADERS = new Set(["x-api-key", "authorization"]);

export function redactHeaders(headers: IncomingHttpHeaders | OutgoingHttpHeaders): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [rawKey, rawValue] of Object.entries(headers)) {
    if (rawValue === undefined) continue;
    const key = rawKey.toLowerCase();
    const value = Array.isArray(rawValue) ? rawValue.join(", ") : String(rawValue);
    out[key] = REDACTED_HEADERS.has(key) ? "***" : value;
  }
  return out;
}

export interface ClippedBody {
  text: string;
  bytes: number;
  truncated: boolean;
}

export function clipBody(text: string, max: number = DEFAULT_BODY_CAP_BYTES): ClippedBody {
  const bytes = Buffer.byteLength(text, "utf8");
  if (bytes <= max) return { text, bytes, truncated: false };
  // Truncate by bytes, not characters, to keep the cap honest under multibyte chars.
  const buf = Buffer.from(text, "utf8");
  const head = buf.subarray(0, max).toString("utf8");
  const dropped = bytes - max;
  return {
    text: `${head}\n… [${dropped} bytes truncated]`,
    bytes,
    truncated: true,
  };
}

export class RecordingContext {
  readonly id: string;
  private readonly _record: RequestRecord;
  private _firstByteRecorded = false;

  constructor(method: string, path: string) {
    this.id = "rec_" + randomBytes(12).toString("hex");
    const now = Date.now();
    this._record = {
      id: this.id,
      timestamp: now,
      method,
      path,
      status: 0,
      request: { headers: {}, bodyText: "", bodyBytes: 0, truncated: false },
      response: { statusCode: 0, headers: {}, bodyBytes: 0, truncated: false },
      timing: { receivedAt: now, lastByteAt: now, totalMs: 0 },
    };
  }

  setModel(model: string | undefined): void {
    this._record.model = model;
  }

  setRequest(headers: IncomingHttpHeaders, body: ClippedBody): void {
    this._record.request = {
      headers: redactHeaders(headers),
      bodyText: body.text,
      bodyBytes: body.bytes,
      truncated: body.truncated,
    };
  }

  setResponse(
    statusCode: number,
    headers: OutgoingHttpHeaders,
    body?: ClippedBody,
  ): void {
    this._record.status = statusCode;
    this._record.response = {
      statusCode,
      headers: redactHeaders(headers),
      bodyText: body?.text,
      bodyBytes: body?.bytes ?? 0,
      truncated: body?.truncated ?? false,
      sseChunks: this._record.response.sseChunks,
    };
  }

  appendSseChunk(chunk: string): void {
    if (!this._record.response.sseChunks) {
      this._record.response.sseChunks = [];
    }
    this._record.response.sseChunks.push(chunk);
    if (!this._firstByteRecorded) {
      this._firstByteRecorded = true;
      this._record.timing.firstByteAt = Date.now();
    }
  }

  mark(stage: "bodyParsed" | "modelResolved" | "upstreamSent" | "firstByte"): void {
    const now = Date.now();
    switch (stage) {
      case "bodyParsed":
        this._record.timing.bodyParsedAt = now;
        return;
      case "modelResolved":
        this._record.timing.modelResolvedAt = now;
        return;
      case "upstreamSent":
        this._record.timing.upstreamSentAt = now;
        return;
      case "firstByte":
        if (!this._firstByteRecorded) {
          this._firstByteRecorded = true;
          this._record.timing.firstByteAt = now;
        }
        return;
    }
  }

  setError(err: unknown): void {
    const { type, message } = classifyError(err);
    this._record.error = {
      type,
      message,
      stack: err instanceof Error ? err.stack : undefined,
    };
  }

  // Snapshot the in-progress record (for finalisation by the recorder).
  snapshot(): RequestRecord {
    const now = Date.now();
    this._record.timing.lastByteAt = now;
    this._record.timing.totalMs = now - this._record.timing.receivedAt;
    return this._record;
  }
}

export class ActivityRecorder {
  private readonly _records = new Map<string, RequestRecord>();
  private readonly _order: string[] = [];
  private readonly _capacity: number;

  private readonly _emitter = new EventEmitter<ActivityEntry>();
  readonly onRecord = this._emitter.event;

  constructor(capacity: number = DEFAULT_CAPACITY) {
    this._capacity = capacity;
  }

  begin(method: string, path: string): RecordingContext {
    return new RecordingContext(method, path);
  }

  finish(ctx: RecordingContext): RequestRecord {
    const record = ctx.snapshot();
    this._records.set(record.id, record);
    this._order.push(record.id);
    while (this._order.length > this._capacity) {
      const evicted = this._order.shift();
      if (evicted !== undefined) this._records.delete(evicted);
    }
    this._emitter.fire(toEntry(record));
    return record;
  }

  get(id: string): RequestRecord | undefined {
    return this._records.get(id);
  }

  list(): RequestRecord[] {
    return this._order.map((id) => this._records.get(id)).filter((r): r is RequestRecord => !!r);
  }

  clear(): void {
    this._records.clear();
    this._order.length = 0;
  }

  size(): number {
    return this._records.size;
  }

  dispose(): void {
    this.clear();
    this._emitter.dispose();
  }
}

function toEntry(r: RequestRecord): ActivityEntry {
  return {
    id: r.id,
    timestamp: r.timestamp,
    method: r.method,
    path: r.path,
    status: r.status || r.response.statusCode,
    durationMs: r.timing.totalMs,
    model: r.model,
  };
}
