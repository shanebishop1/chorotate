const safeMethods = new Set(["GET", "HEAD", "OPTIONS"]);

export class MutationOriginError extends Error {
  readonly status = 403;

  constructor() {
    super("Mutation origin denied");
    this.name = "MutationOriginError";
  }
}

export function requireExactMutationOrigin(
  request: Request,
  canonicalOrigin: string,
): void {
  if (safeMethods.has(request.method.toUpperCase())) return;
  if (!request.headers.get("cookie")) return;
  if (request.headers.get("origin") !== canonicalOrigin) {
    throw new MutationOriginError();
  }
}
