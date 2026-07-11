const DB_NAME = "better-ttb";
const DB_VERSION = 1;
const STORE_NAME = "catalog-cache";

export interface IdbCatalogEntry<TBody> {
  key: string;
  etag: string | null;
  body: TBody;
  updatedAt: string;
}

export async function getCatalogCache<TBody>(
  key: string,
): Promise<IdbCatalogEntry<TBody> | null> {
  const db = await openCatalogDb();

  if (!db) {
    return null;
  }

  return await requestToPromise<IdbCatalogEntry<TBody> | undefined>(
    db.transaction(STORE_NAME, "readonly").objectStore(STORE_NAME).get(key),
  ).then((entry) => entry ?? null);
}

export async function putCatalogCache<TBody>(
  entry: IdbCatalogEntry<TBody>,
): Promise<void> {
  const db = await openCatalogDb();

  if (!db) {
    return;
  }

  await requestToPromise(
    db.transaction(STORE_NAME, "readwrite").objectStore(STORE_NAME).put(entry),
  );
}

function openCatalogDb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === "undefined") {
    return Promise.resolve(null);
  }

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;

      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "key" });
      }
    };
    request.onerror = () => reject(request.error ?? new Error("IndexedDB open failed"));
    request.onsuccess = () => resolve(request.result);
  });
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed"));
    request.onsuccess = () => resolve(request.result);
  });
}
