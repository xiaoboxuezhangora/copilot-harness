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
  const origin = `http://${request.headers.host ?? "mock-jira.local"}`;

  if (request.method !== "GET") {
    writeJson(response, 405, { errorMessages: ["method not allowed"] });
    return;
  }

  if (url.pathname === "/rest/api/2/serverInfo") {
    writeJson(response, 200, {
      baseUrl: origin,
      version: "7.10.1",
      versionNumbers: [7, 10, 1],
      deploymentType: "Server",
      buildNumber: 710002,
      buildDate: "2018-06-13T00:00:00.000+0800",
      serverTitle: "Mock Jira",
    });
    return;
  }

  if (url.pathname === "/rest/api/2/attachment/meta") {
    writeJson(response, 200, {
      enabled: true,
      uploadLimit: 10485760,
    });
    return;
  }

  if (url.pathname === "/rest/api/2/field") {
    writeJson(response, 200, [
      {
        id: "summary",
        name: "Summary",
        custom: false,
        orderable: true,
        navigable: true,
        searchable: true,
        clauseNames: ["summary"],
        schema: {
          type: "string",
          system: "summary",
        },
      },
      {
        id: "customfield_13301",
        name: "目标版本",
        custom: true,
        orderable: true,
        navigable: true,
        searchable: true,
        clauseNames: ["目标版本"],
        schema: {
          type: "string",
          custom: "com.atlassian.jira.plugin.system.customfieldtypes:textfield",
          customId: 13301,
        },
      },
    ]);
    return;
  }

  if (url.pathname === "/rest/api/2/issue/OPS-1") {
    writeJson(response, 200, issuePayload("OPS-1", origin, url));
    return;
  }

  if (url.pathname === "/rest/api/2/issue/OPS-2") {
    writeJson(response, 200, issuePayload("OPS-2", origin, url));
    return;
  }

  if (url.pathname === "/rest/api/2/attachment/10001") {
    writeJson(response, 200, attachmentPayload(origin));
    return;
  }

  if (url.pathname === "/secure/attachment/10001/screenshot.png") {
    writeBinary(response, 200, "image/png", Buffer.from("mock-image"));
    return;
  }

  if (url.pathname === "/rest/api/2/project/OPS") {
    writeJson(response, 200, {
      key: "OPS",
      name: "Operations",
    });
    return;
  }

  if (url.pathname === "/rest/api/2/project/OPS/components") {
    writeJson(response, 200, [
      {
        id: "20001",
        name: "Login",
        description: "Authentication UI",
      },
    ]);
    return;
  }

  if (url.pathname === "/rest/api/2/project/OPS/versions") {
    writeJson(response, 200, [
      {
        id: "30001",
        name: "7.0.191.0",
        released: false,
        archived: false,
        releaseDate: "2026-06-04",
      },
    ]);
    return;
  }

  if (url.pathname === "/rest/api/2/project/OPS/statuses") {
    writeJson(response, 200, [
      {
        id: "1",
        name: "Bug",
        issueTypes: [
          {
            id: "10004",
            name: "Defect",
            statuses: [
              {
                id: "3",
                name: "In Progress",
                statusCategory: {
                  name: "In Progress",
                },
              },
            ],
          },
        ],
      },
    ]);
    return;
  }

  if (url.pathname === "/rest/api/2/issue/OPS-1/remotelink") {
    writeJson(response, 200, [
      {
        id: 40001,
        globalId: "gitlab:mr:1",
        relationship: "relates to",
        object: {
          title: "Merge request",
          url: "http://gitlab.local/mr/1",
        },
      },
    ]);
    return;
  }

  if (url.pathname === "/rest/api/2/issue/OPS-1/transitions") {
    writeJson(response, 200, {
      transitions: [
        {
          id: "21",
          name: "开发完成",
          to: {
            name: "Done",
          },
        },
      ],
    });
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
      issues: [
        issuePayload("OPS-1", origin, url),
        issuePayload("OPS-2", origin, url),
      ],
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

function issuePayload(
  key: string,
  origin: string,
  url: URL,
): Record<string, unknown> {
  const relationFields =
    url.searchParams.get("fields") === "parent,subtasks,issuelinks";
  const expanded = url.searchParams.get("expand") ?? "";
  const baseIssue = {
    key,
    fields: relationFields
      ? {
          parent: {
            key: "OPS-0",
            fields: {
              summary: "Parent issue",
              status: {
                name: "Open",
              },
            },
          },
          subtasks: [
            {
              key: "OPS-3",
              fields: {
                summary: "Subtask issue",
                status: {
                  name: "Open",
                },
              },
            },
          ],
          issuelinks: [
            {
              id: "50001",
              type: {
                name: "Blocks",
                outward: "blocks",
              },
              outwardIssue: {
                key: "OPS-4",
                fields: {
                  summary: "Blocked issue",
                  status: {
                    name: "Open",
                  },
                },
              },
            },
          ],
        }
      : issueFields(key, origin),
  };

  if (expanded.includes("names")) {
    return {
      ...baseIssue,
      names: {
        customfield_13301: "目标版本",
      },
      schema: {
        customfield_13301: {
          type: "string",
        },
      },
      renderedFields: expanded.includes("renderedFields")
        ? {
            description: "<p>Rendered description</p>",
          }
        : undefined,
      changelog: expanded.includes("changelog")
        ? {
            histories: [
              {
                id: "70001",
                items: [
                  {
                    field: "status",
                    fromString: "Open",
                    toString: "In Progress",
                  },
                ],
              },
            ],
          }
        : undefined,
    };
  }

  return baseIssue;
}

function issueFields(key: string, origin: string): Record<string, unknown> {
  return {
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
    attachment: [attachmentPayload(origin)],
  };
}

function attachmentPayload(origin: string): Record<string, unknown> {
  return {
    id: "10001",
    filename: "screenshot.png",
    mimeType: "image/png",
    size: 24576,
    content: `${origin}/secure/attachment/10001/screenshot.png`,
    thumbnail: `${origin}/secure/thumbnail/10001/screenshot.png`,
    created: "2026-04-27T09:00:00.000+0800",
    author: {
      name: "alice",
      displayName: "Alice Reviewer",
      emailAddress: "alice@example.com",
    },
  };
}

function writeJson(
  response: ServerResponse,
  statusCode: number,
  payload: Record<string, unknown> | readonly Record<string, unknown>[],
): void {
  response.writeHead(statusCode, {
    "content-type": "application/json",
  });
  response.end(JSON.stringify(payload));
}

function writeBinary(
  response: ServerResponse,
  statusCode: number,
  contentType: string,
  payload: Buffer,
): void {
  response.writeHead(statusCode, {
    "content-type": contentType,
    "content-length": payload.byteLength,
  });
  response.end(payload);
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
