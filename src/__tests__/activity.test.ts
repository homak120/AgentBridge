import { describe, expect, it } from "vitest";
import {
  ActivityRecorder,
  clipBody,
  redactHeaders,
  type ActivityEntry,
} from "../activity";

describe("redactHeaders", () => {
  it("lowercases keys and redacts x-api-key", () => {
    const out = redactHeaders({
      "X-API-KEY": "sk-supersecret",
      "Content-Type": "application/json",
      "Anthropic-Version": "2023-06-01",
    });
    expect(out).toEqual({
      "x-api-key": "***",
      "content-type": "application/json",
      "anthropic-version": "2023-06-01",
    });
  });

  it("redacts authorization too", () => {
    const out = redactHeaders({ Authorization: "Bearer abc" });
    expect(out).toEqual({ authorization: "***" });
  });

  it("joins array-valued headers", () => {
    const out = redactHeaders({ "set-cookie": ["a=1", "b=2"] });
    expect(out).toEqual({ "set-cookie": "a=1, b=2" });
  });

  it("drops undefined entries", () => {
    const out = redactHeaders({ keep: "1", drop: undefined });
    expect(out).toEqual({ keep: "1" });
  });
});

describe("clipBody", () => {
  it("passes small bodies through unchanged", () => {
    expect(clipBody("hello")).toEqual({
      text: "hello",
      bytes: 5,
      truncated: false,
    });
  });

  it("truncates oversized bodies and reports byte count", () => {
    const large = "x".repeat(300 * 1024); // 300 KB single-byte chars
    const out = clipBody(large, 256 * 1024);
    expect(out.truncated).toBe(true);
    expect(out.bytes).toBe(300 * 1024);
    expect(out.text.length).toBeLessThan(large.length);
    expect(out.text).toMatch(/\[\d+ bytes truncated\]$/);
  });

  it("byte-counts multibyte text correctly", () => {
    // "日" is 3 bytes in UTF-8.
    const out = clipBody("日本");
    expect(out.bytes).toBe(6);
    expect(out.truncated).toBe(false);
  });
});

describe("ActivityRecorder", () => {
  it("snapshots and stores a record on finish", () => {
    const r = new ActivityRecorder();
    const ctx = r.begin("POST", "/v1/messages");
    ctx.setRequest({}, clipBody("{}"));
    ctx.setResponse(200, { "content-type": "application/json" }, clipBody('{"ok":1}'));
    const record = r.finish(ctx);
    expect(record.id).toMatch(/^rec_/);
    expect(r.get(record.id)).toBe(record);
    expect(r.size()).toBe(1);
    r.dispose();
  });

  it("emits onRecord summary on finish", () => {
    const r = new ActivityRecorder();
    const fired: ActivityEntry[] = [];
    r.onRecord((e) => fired.push(e));
    const ctx = r.begin("GET", "/v1/models");
    ctx.setResponse(200, {});
    r.finish(ctx);
    expect(fired).toHaveLength(1);
    expect(fired[0]).toMatchObject({
      method: "GET",
      path: "/v1/models",
      status: 200,
    });
    r.dispose();
  });

  it("evicts the oldest record once capacity is exceeded", () => {
    const r = new ActivityRecorder(3);
    const ids: string[] = [];
    for (let i = 0; i < 5; i++) {
      const ctx = r.begin("POST", "/v1/messages");
      ctx.setResponse(200, {});
      ids.push(r.finish(ctx).id);
    }
    expect(r.size()).toBe(3);
    expect(r.get(ids[0])).toBeUndefined();
    expect(r.get(ids[1])).toBeUndefined();
    expect(r.get(ids[2])).toBeDefined();
    expect(r.get(ids[4])).toBeDefined();
    r.dispose();
  });

  it("captures sse chunks and marks firstByte on first append", () => {
    const r = new ActivityRecorder();
    const ctx = r.begin("POST", "/v1/messages");
    ctx.appendSseChunk("event: message_start\ndata: {}\n\n");
    ctx.appendSseChunk("event: message_stop\ndata: {}\n\n");
    ctx.setResponse(200, {});
    const record = r.finish(ctx);
    expect(record.response.sseChunks).toHaveLength(2);
    expect(record.timing.firstByteAt).toBeDefined();
    r.dispose();
  });

  it("stores an error block when setError is called", () => {
    const r = new ActivityRecorder();
    const ctx = r.begin("POST", "/v1/messages");
    ctx.setError(new Error("boom"));
    ctx.setResponse(500, {});
    const record = r.finish(ctx);
    expect(record.error).toEqual(
      expect.objectContaining({ type: "api_error", message: "boom" }),
    );
    expect(record.error?.stack).toBeDefined();
    r.dispose();
  });

  it("clear() drops every record", () => {
    const r = new ActivityRecorder();
    const ctx = r.begin("POST", "/v1/messages");
    ctx.setResponse(200, {});
    const id = r.finish(ctx).id;
    r.clear();
    expect(r.get(id)).toBeUndefined();
    expect(r.size()).toBe(0);
    r.dispose();
  });
});
