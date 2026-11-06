import { getMigrations } from "better-auth/db/migration";
import { cloudAuthOptions } from "../lib/cloud/auth.ts";
import { createCloudPool } from "../lib/cloud/db.ts";
import { CLOUD_ORIGINS } from "../lib/cloud/protocol.ts";
import { cloudConfig } from "../lib/cloud/runtime.ts";
import { CLOUD_MIGRATION } from "../lib/cloud/schema.ts";

const config = cloudConfig(process.env);
if (!config) throw new Error("Complete the database, email, mode and secret settings before migrating.");
const pool = createCloudPool(config.database);
try {
  await pool.query(CLOUD_MIGRATION);
  const env = await pool.query<{ mode: string }>("SELECT mode FROM cf_environment WHERE singleton");
  if (env.rows.length && env.rows[0].mode !== config.mode) throw new Error("This database was prepared for a different cloud mode.");
  const migration = await getMigrations(cloudAuthOptions(pool, {
    origins: CLOUD_ORIGINS, secret: config.secret, secure: true, async sendMail() { throw new Error("Migration cannot send email"); },
  }));
  await migration.runMigrations();
  const bound = await pool.query("INSERT INTO cf_environment(mode) VALUES($1) ON CONFLICT(singleton) DO UPDATE SET mode=EXCLUDED.mode WHERE cf_environment.mode=EXCLUDED.mode RETURNING mode", [config.mode]);
  if (!bound.rows.length) throw new Error("This database was prepared for a different cloud mode.");
  process.stdout.write("CargoFit cloud database is ready.\n");
} finally {
  await pool.end();
}
