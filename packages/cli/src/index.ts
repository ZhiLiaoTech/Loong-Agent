#!/usr/bin/env node

import { parseChannelsServeArgs, runChannelsServe } from "./channels-serve.js";
import { runCron } from "./commands/cron.js";
import { runPlugins } from "./commands/plugins.js";
import { runGateway } from "./commands/gateway.js";
import { isHelpArgs } from "./cli-impl.js";
import { runChat } from "./commands/chat.js";
import { printHelp } from "./help.js";
import { waitForShutdown } from "./shutdown.js";

const [, , command = "help", ...args] = process.argv;

try {
  if (command === "help" || command === "--help" || command === "-h") {
    printHelp();
    process.exitCode = 0;
  } else if (command === "chat") {
    if (isHelpArgs(args)) {
      printHelp();
    } else {
      await runChat("chat", args);
    }
    process.exitCode = 0;
  } else if (command === "agent") {
    if (isHelpArgs(args)) {
      printHelp();
    } else {
      await runChat("agent", args);
    }
    process.exitCode = 0;
  } else if (command === "gateway") {
    if (isHelpArgs(args)) {
      printHelp();
    } else {
      await runGateway(args);
    }
    process.exitCode = 0;
  } else if (command === "cron") {
    if (isHelpArgs(args)) {
      printHelp();
    } else {
      await runCron(args);
    }
    process.exitCode = 0;
  } else if (command === "plugins") {
    if (isHelpArgs(args)) {
      printHelp();
    } else {
      await runPlugins(args);
    }
    process.exitCode = 0;
  } else if (command === "channels") {
    const sub = args[0];
    if (sub === "serve") {
      const serveArgs = args.slice(1);
      if (isHelpArgs(serveArgs)) {
        printHelp();
      } else {
        const options = await parseChannelsServeArgs(serveArgs);
        const bridge = await runChannelsServe(options);
        process.stderr.write(`Loong channels bridge listening on ${bridge.url}\n`);
        process.stderr.write(`Forwarding to ${options.gatewayUrl}/channels/webhook\n`);
        await waitForShutdown();
        await bridge.stop();
      }
    } else {
      console.error("Usage: loong channels serve [--port <port>] [--gateway-url <url>]");
      process.exitCode = 2;
    }
    process.exitCode = 0;
  } else {
    console.error(`Unknown command: ${command}`);
    printHelp();
    process.exitCode = 2;
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
