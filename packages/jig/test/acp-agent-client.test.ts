import { describe, expect, test } from "bun:test";
import * as acp from "@agentclientprotocol/sdk";

import {
  PrivateAcpProtocolError,
  runPrivateAcpTurn,
} from "../src/internal/acp-agent-client.js";

describe("private ACP Agent client", () => {
  test("runs one stable v1 turn and rejects native tool authority", async () => {
    let permission: acp.RequestPermissionResponse | undefined;
    const agent = deterministicAgent(async (connection, sessionId) => {
      permission = await connection.request(acp.methods.client.session.requestPermission, {
        sessionId,
        toolCall: { toolCallId: "safe-scratch", title: "write scratch" },
        options: [
          { optionId: "once", name: "Once", kind: "allow_once" },
          { optionId: "reject", name: "No", kind: "reject_once" },
        ],
      });
      await message(connection, sessionId, "hello ");
      await message(connection, sessionId, "world");
      return "end_turn";
    });

    await expect(runPrivateAcpTurn(agent, {
      cwd: "/work",
      instructions: "answer once",
    })).resolves.toEqual({ stopReason: "end_turn", text: "hello world" });
    expect(permission).toEqual({ outcome: { outcome: "selected", optionId: "reject" } });
  });

  test("rejects once without granting a persistent permission", async () => {
    let permission: acp.RequestPermissionResponse | undefined;
    const agent = deterministicAgent(async (connection, sessionId) => {
      permission = await connection.request(acp.methods.client.session.requestPermission, {
        sessionId,
        toolCall: { toolCallId: "persistent", title: "persist permission" },
        options: [
          { optionId: "always", name: "Always", kind: "allow_always" },
          { optionId: "reject", name: "No", kind: "reject_once" },
        ],
      });
      return "refusal";
    });

    await expect(runPrivateAcpTurn(agent, {
      cwd: "/work",
      instructions: "answer once",
    })).resolves.toEqual({ stopReason: "refusal", text: "" });
    expect(permission).toEqual({ outcome: { outcome: "selected", optionId: "reject" } });
  });

  test("authenticates over ACP before opening the session", async () => {
    const observed: string[] = [];
    let authentication: acp.AuthenticateRequest | undefined;
    const agent = deterministicAgent(async (connection, sessionId) => {
      observed.push(`prompt:${sessionId}`);
      await message(connection, sessionId, "authenticated");
      return "end_turn";
    }, {
      initialize: ({ params }) => {
        observed.push("initialize");
        expect(params.clientCapabilities.auth?._meta).toEqual({ gateway: true });
        return {
          protocolVersion: params.protocolVersion,
          agentCapabilities: { loadSession: false },
          authMethods: [{ id: "gateway", name: "Gateway", description: "test gateway" }],
        };
      },
      authenticate: ({ params }) => {
        observed.push("authenticate");
        authentication = params;
      },
      sessionNew: () => observed.push("session/new"),
    });

    await expect(runPrivateAcpTurn(agent, {
      cwd: "/work",
      instructions: "answer once",
      authentication: {
        request: {
          methodId: "gateway",
          _meta: { gateway: { headers: { Authorization: "Bearer test-secret" } } },
        },
        clientAuthCapabilities: { _meta: { gateway: true } },
      },
    })).resolves.toEqual({ stopReason: "end_turn", text: "authenticated" });
    expect(authentication).toEqual({
      methodId: "gateway",
      _meta: { gateway: { headers: { Authorization: "Bearer test-secret" } } },
    });
    expect(observed).toEqual([
      "initialize",
      "authenticate",
      "session/new",
      "prompt:test-session",
    ]);
  });

  test("configures one native session before prompting", async () => {
    const observed: string[] = [];
    const agent = deterministicAgent(async (_connection, sessionId) => {
      observed.push(`prompt:${sessionId}`);
      return "end_turn";
    }, {
      setConfigOption: ({ params }) => {
        observed.push(`config:${params.configId}:${String(params.value)}`);
        return { configOptions: [] };
      },
      setMode: ({ params }) => {
        observed.push(`mode:${params.modeId}`);
        return {};
      },
    });

    await expect(runPrivateAcpTurn(agent, {
      cwd: "/work",
      instructions: "answer once",
      configuration: [{ configId: "model", value: "provider/model" }],
      modeId: "read-only",
      sessionMeta: { native: { persist: false } },
    })).resolves.toEqual({ stopReason: "end_turn", text: "" });
    expect(observed).toEqual([
      "config:model:provider/model",
      "mode:read-only",
      "prompt:test-session",
    ]);
  });

  test("rejects invalid requests and bounded text overflow", async () => {
    await expect(runPrivateAcpTurn(deterministicAgent(async () => "end_turn"), {
      cwd: "relative",
      instructions: "answer once",
    })).rejects.toBeInstanceOf(PrivateAcpProtocolError);

    const agent = deterministicAgent(async (connection, sessionId) => {
      await message(connection, sessionId, "x".repeat(8_388_609));
      return "end_turn";
    });
    await expect(runPrivateAcpTurn(agent, {
      cwd: "/work",
      instructions: "answer once",
    })).rejects.toThrow("text limit");
  });
});

function deterministicAgent(
  turn: (connection: acp.AgentContext, sessionId: string) => Promise<acp.StopReason>,
  handlers: {
    readonly initialize?: acp.AgentRequestHandler<typeof acp.methods.agent.initialize>;
    readonly authenticate?: acp.AgentRequestHandler<typeof acp.methods.agent.authenticate>;
    readonly setConfigOption?: acp.AgentRequestHandler<
      typeof acp.methods.agent.session.setConfigOption
    >;
    readonly setMode?: acp.AgentRequestHandler<typeof acp.methods.agent.session.setMode>;
    readonly sessionNew?: () => void;
  } = {},
): acp.AgentApp {
  return acp.agent({ name: "jig-test-agent" })
    .onRequest(acp.methods.agent.initialize, handlers.initialize ?? (({ params }) => ({
      protocolVersion: params.protocolVersion,
      agentCapabilities: { loadSession: false },
    })))
    .onRequest(acp.methods.agent.authenticate, handlers.authenticate ?? (() => ({})))
    .onRequest(
      acp.methods.agent.session.setConfigOption,
      handlers.setConfigOption ?? (() => ({ configOptions: [] })),
    )
    .onRequest(acp.methods.agent.session.setMode, handlers.setMode ?? (() => ({})))
    .onRequest(acp.methods.agent.session.new, () => {
      handlers.sessionNew?.();
      return { sessionId: "test-session" };
    })
    .onRequest(acp.methods.agent.session.prompt, async ({ client, params }) => ({
      stopReason: await turn(client, params.sessionId),
    }));
}

async function message(
  connection: acp.AgentContext,
  sessionId: string,
  text: string,
): Promise<void> {
  await connection.notify(acp.methods.client.session.update, {
    sessionId,
    update: {
      sessionUpdate: "agent_message_chunk",
      content: { type: "text", text },
    },
  });
}
