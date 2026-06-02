import { type IncomingMessage, type ServerResponse } from "node:http";
import { type LoongChannelGatewayOptions } from "@loong/channels";
export interface ChannelsServeOptions {
    host?: string;
    port?: number;
    gatewayUrl: string;
    sharedSecret?: string;
    defaults?: LoongChannelGatewayOptions;
    fetchImpl?: typeof fetch;
}
export interface ChannelsServeHandle {
    url: string;
    stop(): Promise<void>;
}
export declare function runChannelsServe(options: ChannelsServeOptions): Promise<ChannelsServeHandle>;
export declare function createChannelsServeHandler(options: ChannelsServeOptions): (request: IncomingMessage, response: ServerResponse) => Promise<void>;
export declare function parseChannelsServeArgs(args: string[]): Promise<ChannelsServeOptions>;
//# sourceMappingURL=channels-serve.d.ts.map