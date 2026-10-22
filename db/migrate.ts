import { config } from "dotenv";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

config({ path: ".env" });

const isTestEnv =
  process.argv.includes("--env") && process.argv[process.argv.indexOf("--env") + 1] === "test";

const connectionString = isTestEnv ? process.env.DATABASE_URL_TEST : process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error(
    isTestEnv
      ? "DATABASE_URL_TEST is not set"
      : "DATABASE_URL is not set",
  );
}

async function main() {
  const client = postgres(connectionString!, { max: 1 });
  const db = drizzle(client);

  await migrate(db, { migrationsFolder: "drizzle" });

  await client.end();
}

main()
  .then(() => {
    console.log(`Migrations applied successfully (env: ${isTestEnv ? "test" : "default"}).`);
    process.exit(0);
  })
  .catch((error) => {
    console.error("Migration failed:", error);
    process.exit(1);
  });
