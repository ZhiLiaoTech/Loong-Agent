/**
 * Keep in sync with @loong/core stripTextToolBlocks (browser bundle cannot import core).
 */
const XML_TOOL_BLOCK = /<([a-z][a-z0-9_]*)\s*>([\s\S]*?)<\/\1>/gi;

export function stripTextToolBlocks(text: string): string {
  return text.replace(XML_TOOL_BLOCK, "").trim();
}

/** Prefer RPC final text; never fall back to unstripped tool XML. */
export function pickAssistantDisplayText(rpcText: string, streamText: string): string {
  const rpc = stripTextToolBlocks(rpcText).trim();
  const stream = stripTextToolBlocks(streamText).trim();
  return rpc || stream;
}
