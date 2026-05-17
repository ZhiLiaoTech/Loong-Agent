import { ProviderError, sanitizeProviderBody } from "./errors.js";

export async function readServerSentEvents(
  response: Response,
  providerId: string,
  onEvent: (eventName: string | undefined, data: string) => void,
): Promise<void> {
  if (!response.body) {
    throw new ProviderError({
      providerId,
      code: "empty_stream",
      message: `Model provider "${providerId}" returned an empty stream.`,
    });
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) {
      break;
    }
    buffer += decoder.decode(value, { stream: true });
    buffer = drainSseBuffer(buffer, providerId, onEvent);
  }

  buffer += decoder.decode();
  drainSseBuffer(`${buffer}\n\n`, providerId, onEvent);
}

function drainSseBuffer(
  buffer: string,
  providerId: string,
  onEvent: (eventName: string | undefined, data: string) => void,
): string {
  let remaining = buffer;
  let splitIndex = findSseBoundary(remaining);
  while (splitIndex !== -1) {
    const raw = remaining.slice(0, splitIndex);
    remaining = remaining.slice(skipBoundary(remaining, splitIndex));
    emitSseBlock(raw, providerId, onEvent);
    splitIndex = findSseBoundary(remaining);
  }
  return remaining;
}

function findSseBoundary(value: string): number {
  const lf = value.indexOf("\n\n");
  const crlf = value.indexOf("\r\n\r\n");
  if (lf === -1) {
    return crlf;
  }
  if (crlf === -1) {
    return lf;
  }
  return Math.min(lf, crlf);
}

function skipBoundary(value: string, index: number): number {
  return value.startsWith("\r\n\r\n", index) ? index + 4 : index + 2;
}

function emitSseBlock(
  raw: string,
  providerId: string,
  onEvent: (eventName: string | undefined, data: string) => void,
): void {
  const lines = raw.split(/\r?\n/);
  let eventName: string | undefined;
  const dataLines: string[] = [];

  for (const line of lines) {
    if (!line || line.startsWith(":")) {
      continue;
    }
    if (line.startsWith("event:")) {
      const value = line.slice("event:".length).trim();
      eventName = value || undefined;
      continue;
    }
    if (line.startsWith("data:")) {
      dataLines.push(line.slice("data:".length).trimStart());
    }
  }

  if (dataLines.length > 0) {
    try {
      onEvent(eventName, dataLines.join("\n"));
    } catch (error) {
      throw new ProviderError({
        providerId,
        code: "stream_event_error",
        responseBody: sanitizeProviderBody(error instanceof Error ? error.message : String(error)),
        message: "SSE event handler failed.",
      });
    }
  }
}
