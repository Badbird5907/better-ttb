interface StoredKvValue {
  value: string;
  expiresAt: number | null;
}

const kvStore = new Map<string, StoredKvValue>();

export const env = {
  DB: createUnsupportedD1(),
  KV: createMemoryKv(),
  SESSIONS: "20269,20271,20269-20271",
  ADMIN_TOKEN: "dev-admin-token",
};

function createMemoryKv(): KVNamespace {
  return {
    async get(key: string): Promise<string | null> {
      const entry = kvStore.get(key);

      if (!entry) {
        return null;
      }

      if (entry.expiresAt !== null && entry.expiresAt <= Date.now()) {
        kvStore.delete(key);
        return null;
      }

      return entry.value;
    },
    async put(
      key: string,
      value: string,
      options?: { expirationTtl?: number },
    ): Promise<void> {
      kvStore.set(key, {
        value,
        expiresAt: options?.expirationTtl
          ? Date.now() + options.expirationTtl * 1000
          : null,
      });
    },
    async delete(key: string): Promise<void> {
      kvStore.delete(key);
    },
  } as unknown as KVNamespace;
}

function createUnsupportedD1(): D1Database {
  return {
    prepare(): D1PreparedStatement {
      throw new Error("Local D1 mock is not implemented");
    },
  } as unknown as D1Database;
}
