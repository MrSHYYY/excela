import { MongoClient, type Db } from "mongodb";
import type { SessionDoc, UserDoc } from "@/lib/models";

// Cache the connection on globalThis so dev-server reloads and serverless
// invocations reuse one client instead of opening a new pool every time.
const globalForMongo = globalThis as unknown as { excelaDb?: Promise<Db> };

export function getDb(): Promise<Db> {
  if (!globalForMongo.excelaDb) {
    const uri = process.env.MONGODB_URI;
    if (!uri) return Promise.reject(new Error("MONGODB_URI is missing."));
    globalForMongo.excelaDb = (async () => {
      // Small pool: each serverless instance keeps its own, and Atlas free tiers cap total connections.
      const client = new MongoClient(uri, { serverSelectionTimeoutMS: 10_000, maxPoolSize: 10 });
      await client.connect();
      // The database name comes from the URI path (/Excela). MongoDB creates it on first write.
      const db = client.db();
      await Promise.all([
        db.collection<UserDoc>("users").createIndex({ googleId: 1 }, { unique: true }),
        db.collection<UserDoc>("users").createIndex({ email: 1 }),
        db.collection<SessionDoc>("sessions").createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
        db.collection<SessionDoc>("sessions").createIndex({ userId: 1 }),
      ]);
      return db;
    })().catch((error) => {
      globalForMongo.excelaDb = undefined; // allow a retry on the next request
      throw error;
    });
  }
  return globalForMongo.excelaDb;
}

export async function usersCollection() {
  return (await getDb()).collection<UserDoc>("users");
}

export async function sessionsCollection() {
  return (await getDb()).collection<SessionDoc>("sessions");
}
