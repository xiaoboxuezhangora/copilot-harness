import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import type { IncomingMessage, Server, ServerResponse } from "node:http";

export interface MockJiraServer {
  readonly baseUrl: string;
  readonly close: () => Promise<void>;
}

export async function startMockJiraServer(): Promise<MockJiraServer> {
  const server = createServer(handleRequest);

  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });

  const address = server.address();
  if (!isAddressInfo(address)) {
    throw new Error("Mock Jira server did not bind to a TCP port");
  }

  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () => closeServer(server),
  };
}

function handleRequest(
  request: IncomingMessage,
  response: ServerResponse,
): void {
  const url = new URL(request.url ?? "/", "http://mock-jira.local");

  if (request.method !== "GET") {
    writeJson(response, 405, { errorMessages: ["method not allowed"] });
    return;
  }

  if (url.pathname === "/rest/api/2/issue/OPS-1") {
    writeJson(response, 200, issuePayload("OPS-1"));
    return;
  }

  if (url.pathname === "/rest/api/2/issue/OPS-2") {
    writeJson(response, 200, issuePayload("OPS-2"));
    return;
  }

  if (url.pathname === "/rest/api/2/search") {
    const jql = url.searchParams.get("jql") ?? "";
    if (jql.includes("UNAVAILABLE")) {
      writeJson(response, 503, {
        errorMessages: ["Jira temporarily unavailable"],
      });
      return;
    }

    writeJson(response, 200, {
      startAt: 0,
      maxResults: Number(url.searchParams.get("maxResults") ?? "20"),
      total: 2,
      issues: [issuePayload("OPS-1"), issuePayload("OPS-2")],
    });
    return;
  }

  if (url.pathname === "/rest/api/2/issue/OPS-1/comment") {
    writeJson(response, 200, {
      comments: [
        {
          id: "10000",
          body: "Checked by alice@example.com from 10.20.30.40 token=abc123",
          author: {
            name: "alice",
            displayName: "Alice Reviewer",
            emailAddress: "alice@example.com",
          },
          created: "2026-04-27T10:00:00.000+0800",
          updated: "2026-04-27T10:10:00.000+0800",
        },
      ],
    });
    return;
  }

  writeJson(response, 404, { errorMessages: ["not found"] });
}

function issuePayload(key: string): Record<string, unknown> {
  return {
    key,
    fields: {
      summary: `${key} summary`,
      description: "Reporter alice@example.com saw 10.20.30.40 token=abc123",
      status: {
        name: "Open",
      },
      assignee: {
        name: "bob",
        displayName: "Bob Assignee",
        emailAddress: "bob@example.com",
      },
      reporter: {
        emailAddress: "reporter@example.com",
      },
      priority: {
        name: "High",
      },
      labels: ["w2", "mock"],
      project: {
        key: "OPS",
        name: "Operations",
      },
      attachment: [
        {
          id: "10001",
          filename: "screenshot.png",
          mimeType: "image/png",
          size: 24576,
          content:
            "http://mock-jira.local/secure/attachment/10001/screenshot.png",
          created: "2026-04-27T09:00:00.000+0800",
        },
      ],
    },
  };
}

function writeJson(
  response: ServerResponse,
  statusCode: number,
  payload: Record<string, unknown>,
): void {
  response.writeHead(statusCode, {
    "content-type": "application/json",
  });
  response.end(JSON.stringify(payload));
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error === undefined) {
        resolve();
        return;
      }

      reject(error);
    });
  });
}

function isAddressInfo(
  address: string | AddressInfo | null,
): address is AddressInfo {
  return typeof address === "object" && address !== null;
}
