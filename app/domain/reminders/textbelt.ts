export const TEXTBELT_SMS_ENDPOINT = "https://textbelt.com/text";

export interface TextbeltSmsInput {
  phone: string;
  message: string;
}

export interface TextbeltSuccessResponse {
  success: true;
  quotaRemaining: number;
  textId: number | string;
}

export interface TextbeltFailureResponse {
  success: false;
  quotaRemaining?: number;
  error: string;
}

export type TextbeltResponse =
  | TextbeltSuccessResponse
  | TextbeltFailureResponse;

export interface TextbeltTransport {
  send(input: TextbeltSmsInput): Promise<TextbeltResponse>;
}

export interface TextbeltTransportOptions {
  fetch?: typeof globalThis.fetch;
  apiKey: string;
  timeoutMilliseconds: number;
}

export class TextbeltTransportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TextbeltTransportError";
  }
}

export class TextbeltPreSubmitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TextbeltPreSubmitError";
  }
}

const gsm7Basic = new Set(
  Array.from(
    "@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà",
  ),
);
const gsm7Extension = new Set(Array.from("\f^{}\\[~]|€"));

export function gsm7SeptetLength(message: string): number {
  let length = 0;
  for (const character of message) {
    if (gsm7Basic.has(character)) length += 1;
    else if (gsm7Extension.has(character)) length += 2;
    else throw new TextbeltPreSubmitError("SMS content must use GSM-7");
  }
  return length;
}

export function assertSingleSegmentGsm7(message: string): void {
  if (!message) throw new TextbeltPreSubmitError("SMS content is required");
  if (gsm7SeptetLength(message) > 160) {
    throw new TextbeltPreSubmitError("SMS content exceeds one GSM-7 segment");
  }
}

function isQuota(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isTextId(value: unknown): value is number | string {
  return (
    (typeof value === "number" && Number.isFinite(value)) ||
    (typeof value === "string" && value.trim() !== "")
  );
}

function parseTextbeltResponse(value: unknown): TextbeltResponse {
  if (typeof value !== "object" || value === null || !("success" in value)) {
    throw new TextbeltTransportError("Invalid Textbelt response");
  }

  const response = value as Record<string, unknown>;
  if (
    response.success === true &&
    isQuota(response.quotaRemaining) &&
    isTextId(response.textId)
  ) {
    return {
      success: true,
      quotaRemaining: response.quotaRemaining,
      textId: response.textId,
    };
  }
  if (
    response.success === false &&
    typeof response.error === "string" &&
    response.error.trim() !== "" &&
    (response.quotaRemaining === undefined || isQuota(response.quotaRemaining))
  ) {
    return {
      success: false,
      ...(response.quotaRemaining === undefined
        ? {}
        : { quotaRemaining: response.quotaRemaining }),
      error: response.error,
    };
  }
  throw new TextbeltTransportError("Invalid Textbelt response");
}

export function createTextbeltTransport(
  options: TextbeltTransportOptions,
): TextbeltTransport {
  if (!options.apiKey || options.apiKey !== options.apiKey.trim()) {
    throw new RangeError("Textbelt API key is required");
  }
  if (
    !Number.isInteger(options.timeoutMilliseconds) ||
    options.timeoutMilliseconds < 1_000 ||
    options.timeoutMilliseconds > 30_000
  ) {
    throw new RangeError(
      "Textbelt timeout must be from 1000 to 30000 milliseconds",
    );
  }
  const request = options.fetch ?? globalThis.fetch;

  return {
    async send(input) {
      if (!/^\+[1-9]\d{1,14}$/.test(input.phone)) {
        throw new TextbeltPreSubmitError("SMS phone must be E.164");
      }
      assertSingleSegmentGsm7(input.message);
      const controller = new AbortController();
      const timeout = setTimeout(
        () => controller.abort(),
        options.timeoutMilliseconds,
      );
      try {
        const response = await request(TEXTBELT_SMS_ENDPOINT, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            phone: input.phone,
            message: input.message,
            key: options.apiKey,
          }),
          signal: controller.signal,
        });
        let body: unknown;
        try {
          body = await response.json();
        } catch {
          throw new TextbeltTransportError("Invalid Textbelt response");
        }
        return parseTextbeltResponse(body);
      } catch (error) {
        if (
          error instanceof TextbeltTransportError ||
          error instanceof TextbeltPreSubmitError
        ) {
          throw error;
        }
        throw new TextbeltTransportError("Textbelt request failed");
      } finally {
        clearTimeout(timeout);
      }
    },
  };
}
