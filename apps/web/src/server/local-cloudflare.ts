interface StoredKvValue {
  value: string | ArrayBuffer;
  expiresAt: number | null;
}

const kvStore = new Map<string, StoredKvValue>();

export const env = {
  DB: createUnsupportedD1(),
  KV: createMemoryKv(),
  COURSE_REFRESH_RATE_LIMIT: {
    async limit(): Promise<{ success: boolean }> {
      return { success: true };
    },
  },
  SESSIONS: "20269,20271,20269-20271",
  ADMIN_TOKEN: "dev-admin-token",
};

function createMemoryKv(): KVNamespace {
  return {
    async get(
      key: string,
      type?: "text" | "arrayBuffer",
    ): Promise<string | ArrayBuffer | null> {
      const entry = kvStore.get(key);

      if (!entry) {
        return null;
      }

      if (entry.expiresAt !== null && entry.expiresAt <= Date.now()) {
        kvStore.delete(key);
        return null;
      }

      if (type === "arrayBuffer") {
        return typeof entry.value === "string"
          ? new TextEncoder().encode(entry.value).buffer
          : entry.value;
      }
      return typeof entry.value === "string"
        ? entry.value
        : new TextDecoder().decode(entry.value);
    },
    async put(
      key: string,
      value: string | ArrayBuffer,
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
