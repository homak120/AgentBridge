import { describe, expect, it } from "vitest";
import { classifyError, envelope, HttpError } from "../util/errors";

describe("error envelope", () => {
  it("produces the Anthropic shape", () => {
    expect(envelope("invalid_request_error", "bad")).toEqual({
      type: "error",
      error: { type: "invalid_request_error", message: "bad" },
    });
  });

  it("classifies HttpError verbatim", () => {
    const err = new HttpError(404, "not_found_error", "no such model");
    expect(classifyError(err)).toEqual({
      status: 404,
      type: "not_found_error",
      message: "no such model",
    });
  });

  it("collapses unknown errors to 500 api_error", () => {
    expect(classifyError(new Error("boom"))).toEqual({
      status: 500,
      type: "api_error",
      message: "boom",
    });
    expect(classifyError("plain string")).toEqual({
      status: 500,
      type: "api_error",
      message: "plain string",
    });
  });
});
