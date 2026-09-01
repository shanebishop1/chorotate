import { describe, expect, it } from "vitest";

import { requireExactMutationOrigin } from "./origin";

const canonicalOrigin = "https://chorotate.example";

function mutation(origin?: string, cookie = "chorotate.session=opaque") {
  const headers = new Headers({ cookie });
  if (origin !== undefined) headers.set("origin", origin);
  return new Request(`${canonicalOrigin}/assignments`, {
    method: "POST",
    headers,
  });
}

describe("exact mutation origin", () => {
  it("accepts the exact canonical origin", () => {
    expect(() =>
      requireExactMutationOrigin(mutation(canonicalOrigin), canonicalOrigin),
    ).not.toThrow();
  });

  it.each([undefined, "https://evil.example", `${canonicalOrigin}/`])(
    "rejects a missing or non-exact origin (%s)",
    (origin) => {
      expect(() =>
        requireExactMutationOrigin(mutation(origin), canonicalOrigin),
      ).toThrow(expect.objectContaining({ status: 403 }));
    },
  );

  it("does not require Origin for safe methods or requests without cookies", () => {
    expect(() =>
      requireExactMutationOrigin(
        new Request(`${canonicalOrigin}/schedule`),
        canonicalOrigin,
      ),
    ).not.toThrow();
    expect(() =>
      requireExactMutationOrigin(mutation(undefined, ""), canonicalOrigin),
    ).not.toThrow();
  });
});
