export class GatewayHttpError extends Error {
  constructor(
    readonly statusCode: number,
    message: string,
  ) {
    super(message);
    this.name = "GatewayHttpError";
  }
}

export function badRequest(message: string): never {
  throw new GatewayHttpError(400, message);
}

export function errorToStatusCode(error: unknown): number {
  if (error instanceof GatewayHttpError) {
    return error.statusCode;
  }
  if (error instanceof SyntaxError) {
    return 400;
  }
  return 500;
}
