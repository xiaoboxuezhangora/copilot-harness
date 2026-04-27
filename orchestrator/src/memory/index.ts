export interface MemoryRecord {
  readonly id: string;
  readonly namespace: string;
  readonly content: string;
  readonly createdAtIso: string;
}

export interface MemoryQuery {
  readonly namespace: string;
  readonly query: string;
  readonly limit: number;
}

export interface MemoryClient {
  upsert(_record: MemoryRecord): Promise<void>;
  query(_input: MemoryQuery): Promise<readonly MemoryRecord[]>;
}

export class MemoryMcpClientStub implements MemoryClient {
  upsert(_record: MemoryRecord): Promise<void> {
    throw new Error('Not implemented in W1 skeleton.');
  }

  query(_input: MemoryQuery): Promise<readonly MemoryRecord[]> {
    throw new Error('Not implemented in W1 skeleton.');
  }
}
