import type { IncomingMessage, ServerResponse } from "node:http";

export class GatewayHttpError extends Error {
  readonly statusCode: number;

  constructor(statusCode: number, message: string) {
    super(message);
    this.name = "GatewayHttpError";
    this.statusCode = statusCode;
  }
}

export function badRequest(message: string): never {
  throw new GatewayHttpError(400, message);
}

export function errorToStatusCode(error: unknown): number {
  if (error instanceof GatewayHttpError) {
    return error.statusCode;
  }
  return 500;
}

export const MAX_REQUEST_BYTES = 32 * 1024 * 1024;

export function readSingleHeader(request: IncomingMessage, name: string): string | undefined {
  const value = request.headers[name.toLowerCase()];
  if (Array.isArray(value)) {
    return value[0];
  }
  return value;
}

export function applyCors(request: IncomingMessage, response: ServerResponse): void {
  const host = request.headers.host?.split(":")[0]?.toLowerCase();
  const origin = host === "127.0.0.1"
    ? "http://127.0.0.1"
    : "http://localhost";
  response.setHeader("access-control-allow-origin", origin);
  response.setHeader("access-control-allow-methods", "GET,POST,OPTIONS");
  response.setHeader("access-control-allow-headers", "content-type,authorization,x-dragon-secret");
}

export async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.byteLength;
    if (size > MAX_REQUEST_BYTES) {
      throw new GatewayHttpError(413, `Request body exceeds ${MAX_REQUEST_BYTES} bytes.`);
    }
    chunks.push(buffer);
  }
  const raw = Buffer.concat(chunks).toString("utf8").trim();
  if (!raw) {
    throw new GatewayHttpError(400, "Request body cannot be empty.");
  }
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new GatewayHttpError(400, `Invalid JSON request body: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export function writeJson(response: ServerResponse, statusCode: number, payload: unknown): void {
  const body = JSON.stringify(payload);
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
  });
  response.end(body);
}

export function writeHtml(response: ServerResponse, statusCode: number, html: string): void {
  response.writeHead(statusCode, {
    "content-type": "text/html; charset=utf-8",
    "content-length": Buffer.byteLength(html),
  });
  response.end(html);
}

export function writeSse(response: ServerResponse, eventName: string, payload: unknown): void {
  const body = JSON.stringify(payload);
  response.write(`event: ${eventName}\n`);
  for (const line of body.split(/\r?\n/)) {
    response.write(`data: ${line}\n`);
  }
  response.write("\n");
}
