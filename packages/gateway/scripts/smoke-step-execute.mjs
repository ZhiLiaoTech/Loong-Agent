import { createHttpGateway } from "../dist/index.js";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function rpc(baseUrl, type, params) {
  const response = await fetch(`${baseUrl}/rpc`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer secret",
    },
    body: JSON.stringify({ type, id: `${type}-1`, params }),
  });
  return { status: response.status, json: await response.json() };
}

async function main() {
  let turnCalls = 0;
  let lastMessage = "";
  const runtime = {
    async runTurn(input) {
      turnCalls += 1;
      lastMessage = input.message;
      return {
        runId: `step-run-${turnCalls}`,
        status: "ok",
        messages: [
          { id: "u1", role: "user", content: input.message, createdAt: new Date().toISOString() },
          {
            id: "a1",
            role: "assistant",
            content: JSON.stringify({ action: "refund", params: { orderId: "o-1" } }),
            createdAt: new Date().toISOString(),
          },
        ],
        usage: { totalTokens: 10, costUsd: 0.001 },
      };
    },
    subscribe() {
      return () => undefined;
    },
  };

  const gateway = createHttpGateway({ runtime });
  await gateway.start({ host: "127.0.0.1", port: 0, authMode: "shared-secret", sharedSecret: "secret" });
  const address = gateway.address();
  assert(address !== undefined, "gateway should start");

  try {
    const first = await rpc(address.url, "step.execute", {
      idempotencyKey: "idem-step-1",
      stepContext: { intent: "refund order o-1" },
    });
    assert(first.status === 200 && first.json.ok === true, "step.execute should succeed");
    assert(first.json.payload.status === "ok", "status ok");
    assert(first.json.payload.proposal?.action === "refund", "proposal action");
    assert(turnCalls === 1, "runtime called once");

    const second = await rpc(address.url, "step.execute", {
      idempotencyKey: "idem-step-1",
      stepContext: { intent: "refund order o-1" },
    });
    assert(second.json.payload.replayed === true, "should replay");
    assert(turnCalls === 1, "runtime not called again");

    await rpc(address.url, "step.execute", {
      idempotencyKey: "idem-step-2",
      stepContext: { intent: "continue", history: [{ role: "user", content: "hello" }] },
    });
    assert(lastMessage.includes("Context:"), "history injected");
    console.log("step.execute smoke test passed");
  } finally {
    await gateway.stop();
  }
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
