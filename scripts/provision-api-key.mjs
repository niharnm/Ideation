import { createHmac, randomBytes, randomUUID } from "node:crypto";
import { neon } from "@neondatabase/serverless";

const [organizationId, rolesArgument] = process.argv.slice(2);
if (!organizationId || !rolesArgument) {
  console.error("Usage: node scripts/provision-api-key.mjs <organization-id> <claimant,recipient,webhook:manage>");
  process.exit(1);
}
if (!process.env.DATABASE_URL || !process.env.API_KEY_PEPPER) {
  console.error("DATABASE_URL and API_KEY_PEPPER must be configured.");
  process.exit(1);
}

const roles = rolesArgument.split(",").map((role) => role.trim()).filter(Boolean);
const allowedRoles = new Set(["claimant", "recipient", "webhook:manage"]);
if (roles.length === 0 || roles.some((role) => !allowedRoles.has(role))) {
  console.error("Roles must be claimant, recipient, and/or webhook:manage.");
  process.exit(1);
}

const id = randomUUID().replaceAll("-", "");
const secret = randomBytes(32).toString("base64url");
const secretHash = createHmac("sha256", process.env.API_KEY_PEPPER).update(secret).digest("base64url");
const sql = neon(process.env.DATABASE_URL);
await sql`INSERT INTO api_keys (id, organization_id, roles, secret_hash) VALUES (${id}, ${organizationId}, ${JSON.stringify(roles)}::jsonb, ${secretHash})`;
console.log(`hsk_${id}_${secret}`);
