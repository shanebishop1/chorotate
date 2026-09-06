import { describe, expect, it, vi } from "vitest";

import {
  assertSingleSegmentGsm7,
  createTextbeltTransport,
  gsm7SeptetLength,
  TEXTBELT_SMS_ENDPOINT,
} from "./textbelt";

const phoneFromD1 = "+15555550102";
const message = "ChoRotate: Trash is yours this week.";

describe("Textbelt transport contract", () => {
  it("accounts for GSM-7 extension characters and rejects unsupported or multi-segment text", () => {
    expect(gsm7SeptetLength("A^{}\\[~]|€")).toBe(19);
    expect(() => assertSingleSegmentGsm7("A".repeat(160))).not.toThrow();
    expect(() => assertSingleSegmentGsm7("A".repeat(161))).toThrow(/segment/i);
    expect(() => assertSingleSegmentGsm7("ChoRotate 😀")).toThrow(/GSM-7/i);
  });

  it("posts the configured private-key SMS contract without an authorization header", async () => {
    const requests: Request[] = [];
    const fetch = vi.fn<typeof globalThis.fetch>(async (input, init) => {
      requests.push(new Request(input, init));
      return Response.json({
        success: true,
        quotaRemaining: 0,
        textId: 42,
      });
    });
    const transport = createTextbeltTransport({
      fetch,
      apiKey: "private-textbelt-key",
      timeoutMilliseconds: 10_000,
    });

    await expect(
      transport.send({ phone: phoneFromD1, message }),
    ).resolves.toEqual({ success: true, quotaRemaining: 0, textId: 42 });

    expect(TEXTBELT_SMS_ENDPOINT).toBe("https://textbelt.com/text");
    expect(requests).toHaveLength(1);
    const request = requests[0]!;
    expect(request.url).toBe(TEXTBELT_SMS_ENDPOINT);
    expect(request.method).toBe("POST");
    expect(request.headers.get("Content-Type")).toBe("application/json");
    expect(request.headers.has("Authorization")).toBe(false);
    await expect(request.json()).resolves.toEqual({
      phone: phoneFromD1,
      message,
      key: "private-textbelt-key",
    });
  });

  it("returns documented success and failure response variants", async () => {
    const responses = [
      Response.json({
        success: true,
        quotaRemaining: 0,
        textId: "provider-text-id",
      }),
      Response.json({
        success: false,
        quotaRemaining: 0,
        error: "Out of quota",
      }),
    ];
    const transport = createTextbeltTransport({
      fetch: async () => responses.shift()!,
      apiKey: "private-textbelt-key",
      timeoutMilliseconds: 10_000,
    });

    await expect(
      transport.send({ phone: phoneFromD1, message }),
    ).resolves.toEqual({
      success: true,
      quotaRemaining: 0,
      textId: "provider-text-id",
    });
    await expect(
      transport.send({ phone: phoneFromD1, message }),
    ).resolves.toEqual({
      success: false,
      quotaRemaining: 0,
      error: "Out of quota",
    });
  });

  it("rejects malformed provider responses with a sanitized boundary error", async () => {
    const transport = createTextbeltTransport({
      fetch: async () => Response.json({ success: true, private: message }),
      apiKey: "private-textbelt-key",
      timeoutMilliseconds: 10_000,
    });

    await expect(
      transport.send({ phone: phoneFromD1, message }),
    ).rejects.toThrow("Invalid Textbelt response");
    expect(() =>
      createTextbeltTransport({
        apiKey: "private-textbelt-key",
        timeoutMilliseconds: 999,
      }),
    ).toThrow("Textbelt timeout must be from 1000 to 30000 milliseconds");
  });

  it("validates content before initiating fetch", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>();
    const transport = createTextbeltTransport({
      fetch,
      apiKey: "private-textbelt-key",
      timeoutMilliseconds: 10_000,
    });

    await expect(
      transport.send({ phone: phoneFromD1, message: "😀" }),
    ).rejects.toThrow(/GSM-7/i);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("maps timeout/network failure to a sanitized transport error", async () => {
    const transport = createTextbeltTransport({
      fetch: async (_input, init) =>
        await new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(new DOMException("private", "AbortError")),
          );
        }),
      apiKey: "private-textbelt-key",
      timeoutMilliseconds: 1_000,
    });

    await expect(
      transport.send({ phone: phoneFromD1, message }),
    ).rejects.toThrow("Textbelt request failed");
  });
});
