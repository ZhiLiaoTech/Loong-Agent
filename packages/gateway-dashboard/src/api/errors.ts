export class GatewayApiError extends Error {
  readonly status: number;
  readonly rpcType: string | undefined;

  constructor(message: string, options: { status?: number; rpcType?: string } = {}) {
    super(message);
    this.name = "GatewayApiError";
    this.status = options.status ?? 0;
    this.rpcType = options.rpcType;
  }
}
