import { createCipheriv, createDecipheriv, createHmac, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { DecryptCommand, GenerateDataKeyCommand, KMSClient } from "@aws-sdk/client-kms";
import { fromWebToken } from "@aws-sdk/credential-providers";
import { getVercelOidcToken } from "@vercel/oidc";
import { neon } from "@neondatabase/serverless";
import { HANDSHAKE_EVENT_SCHEMA_VERSION, type HandshakeDataScope, type HandshakeEvent, type PartyReference } from "../handshake-event.ts";
import { validateHandshakeEvent } from "../validate-handshake-event.ts";

export type ApiRole = "claimant" | "recipient" | "webhook:manage";

export interface ApiPrincipal { organizationId: string; roles: readonly ApiRole[]; keyId: string }

export interface ApiKeyRecord { id: string; organizationId: string; roles: readonly ApiRole[]; secretHash: string; revokedAt?: string }

export interface SealedValue { ciphertext: string; iv: string; tag: string; wrappedKey: string; algorithm: "aes-256-gcm" }

export interface HandshakeRecord {
  id: string;
  version: number;
  status: "pending" | "active" | "denied" | "revoked" | "expired";
  claimantOrganizationId: string;
  recipientOrganizationId: string;
  claimantId: string;
  recipient: PartyReference;
  dataScope: HandshakeDataScope;
  events: HandshakeEvent[];
  sealedValues: Record<string, SealedValue>;
  createdAt: string;
  updatedAt: string;
}

export interface PassportConstraint {
  id: string;
  label: string;
  severity: "severe" | "moderate" | "mild";
  crossContaminationTolerance: boolean;
}

export interface PassportProfile {
  claimantId: string;
  constraints: PassportConstraint[];
  version: number;
  updatedAt: string;
}

export interface PassportRecord {
  claimantOrganizationId: string;
  claimantId: string;
  version: number;
  sealedProfile: SealedValue;
  updatedAt: string;
}

export interface HandshakeStore {
  create(record: HandshakeRecord): Promise<void>;
  read(id: string): Promise<HandshakeRecord | null>;
  list(organizationId: string, cursor?: string, limit?: number): Promise<{ records: HandshakeRecord[]; nextCursor?: string }>;
  write(record: HandshakeRecord, expectedVersion: number): Promise<boolean>;
  getKey(id: string): Promise<ApiKeyRecord | null>;
  readPassport(organizationId: string, claimantId: string): Promise<PassportRecord | null>;
  writePassport(record: PassportRecord, expectedVersion: number): Promise<boolean>;
}

export class ApiError extends Error {
  readonly status: number; readonly code: string; readonly details?: unknown;
  constructor(status: number, code: string, message: string, details?: unknown) { super(message); this.status = status; this.code = code; this.details = details; }
}

export interface ValueCipher { seal(value: unknown, context: Record<string, string>): Promise<SealedValue>; open(value: SealedValue, context: Record<string, string>): Promise<unknown> }

export class LocalEnvelopeCipher implements ValueCipher {
  private readonly rootKey: Buffer;
  constructor(rootKey: Buffer | string = createHmac("sha256", "handshake-local-development-key").update(process.env.LOCAL_DATA_KEY ?? "local-only").digest()) { this.rootKey = Buffer.isBuffer(rootKey) ? rootKey : createHmac("sha256", "handshake-local-development-key").update(rootKey).digest(); }
  async seal(value: unknown): Promise<SealedValue> {
    const key = randomBytes(32); const iv = randomBytes(12); const cipher = createCipheriv("aes-256-gcm", key, iv);
    const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
    const wrapIv = randomBytes(12); const wrap = createCipheriv("aes-256-gcm", this.rootKey, wrapIv);
    const wrappedKey = Buffer.concat([wrapIv, wrap.update(key), wrap.final(), wrap.getAuthTag()]);
    return { ciphertext: ciphertext.toString("base64"), iv: iv.toString("base64"), tag: cipher.getAuthTag().toString("base64"), wrappedKey: wrappedKey.toString("base64"), algorithm: "aes-256-gcm" };
  }
  async open(value: SealedValue): Promise<unknown> {
    const wrapped = Buffer.from(value.wrappedKey, "base64"); const wrap = createDecipheriv("aes-256-gcm", this.rootKey, wrapped.subarray(0, 12));
    wrap.setAuthTag(wrapped.subarray(wrapped.length - 16)); const key = Buffer.concat([wrap.update(wrapped.subarray(12, -16)), wrap.final()]);
    const cipher = createDecipheriv("aes-256-gcm", key, Buffer.from(value.iv, "base64")); cipher.setAuthTag(Buffer.from(value.tag, "base64"));
    return JSON.parse(Buffer.concat([cipher.update(Buffer.from(value.ciphertext, "base64")), cipher.final()]).toString("utf8"));
  }
}

export class AwsKmsEnvelopeCipher implements ValueCipher {
  private readonly client: KMSClient;
  private readonly keyId: string;
  constructor(keyId: string) {
    this.keyId = keyId;
    const roleArn = process.env.AWS_ROLE_ARN;
    this.client = new KMSClient({
      region: process.env.AWS_REGION,
      ...(roleArn ? {
        credentials: async () => fromWebToken({
          roleArn,
          roleSessionName: "handshake-api",
          webIdentityToken: await getVercelOidcToken(),
        })(),
      } : {}),
    });
  }
  async seal(value: unknown, context: Record<string, string>): Promise<SealedValue> {
    const generated = await this.client.send(new GenerateDataKeyCommand({ KeyId: this.keyId, KeySpec: "AES_256", EncryptionContext: context }));
    if (!generated.Plaintext || !generated.CiphertextBlob) throw new ApiError(500, "kms_failure", "KMS did not return a data key.");
    const iv = randomBytes(12); const cipher = createCipheriv("aes-256-gcm", Buffer.from(generated.Plaintext), iv);
    const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
    return { ciphertext: ciphertext.toString("base64"), iv: iv.toString("base64"), tag: cipher.getAuthTag().toString("base64"), wrappedKey: Buffer.from(generated.CiphertextBlob).toString("base64"), algorithm: "aes-256-gcm" };
  }
  async open(value: SealedValue, context: Record<string, string>): Promise<unknown> {
    const decrypted = await this.client.send(new DecryptCommand({ CiphertextBlob: Buffer.from(value.wrappedKey, "base64"), EncryptionContext: context }));
    if (!decrypted.Plaintext) throw new ApiError(500, "kms_failure", "KMS could not decrypt the data key.");
    const cipher = createDecipheriv("aes-256-gcm", Buffer.from(decrypted.Plaintext), Buffer.from(value.iv, "base64")); cipher.setAuthTag(Buffer.from(value.tag, "base64"));
    return JSON.parse(Buffer.concat([cipher.update(Buffer.from(value.ciphertext, "base64")), cipher.final()]).toString("utf8"));
  }
}

export class MemoryHandshakeStore implements HandshakeStore {
  readonly records = new Map<string, HandshakeRecord>(); readonly keys = new Map<string, ApiKeyRecord>(); readonly passports = new Map<string, PassportRecord>();
  async create(record: HandshakeRecord) { if (this.records.has(record.id)) throw new ApiError(409, "conflict", "Handshake already exists."); this.records.set(record.id, structuredClone(record)); }
  async read(id: string) { const record = this.records.get(id); return record ? structuredClone(record) : null; }
  async list(org: string, cursor?: string, limit = 25) { const records = [...this.records.values()].filter((r) => r.claimantOrganizationId === org || r.recipientOrganizationId === org).sort((a, b) => b.createdAt.localeCompare(a.createdAt)); const start = cursor ? records.findIndex((r) => r.id === cursor) + 1 : 0; const page = records.slice(start, start + Math.min(limit, 100)); return { records: structuredClone(page), ...(start + page.length < records.length ? { nextCursor: page.at(-1)?.id } : {}) }; }
  async write(record: HandshakeRecord, expectedVersion: number) { const existing = this.records.get(record.id); if (!existing || existing.version !== expectedVersion) return false; this.records.set(record.id, structuredClone({ ...record, version: expectedVersion + 1 })); return true; }
  async getKey(id: string) { return this.keys.get(id) ?? null; }
  async readPassport(organizationId: string, claimantId: string) { const value = this.passports.get(`${organizationId}:${claimantId}`); return value ? structuredClone(value) : null; }
  async writePassport(record: PassportRecord, expectedVersion: number) { const key = `${record.claimantOrganizationId}:${record.claimantId}`; const current = this.passports.get(key); if ((current?.version ?? 0) !== expectedVersion) return false; this.passports.set(key, structuredClone(record)); return true; }
}

export class PostgresHandshakeStore implements HandshakeStore {
  private readonly sql = neon(process.env.DATABASE_URL!);
  private passportSchemaReady?: Promise<unknown>;
  private async ensurePassportSchema() {
    if (!this.passportSchemaReady) {
      this.passportSchemaReady = this.sql`CREATE TABLE IF NOT EXISTS passport_profiles (claimant_organization_id text NOT NULL, claimant_id text NOT NULL, version integer NOT NULL, sealed_profile jsonb NOT NULL, updated_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (claimant_organization_id, claimant_id))`.catch((error) => { this.passportSchemaReady = undefined; throw error; });
    }
    await this.passportSchemaReady;
  }
  async create(record: HandshakeRecord) { await this.sql`INSERT INTO handshake_records (id, claimant_organization_id, recipient_organization_id, status, expires_at, version, document) VALUES (${record.id}, ${record.claimantOrganizationId}, ${record.recipientOrganizationId}, ${record.status}, ${record.dataScope.validUntil}, ${record.version}, ${JSON.stringify(record)}::jsonb)`; }
  async read(id: string) { const rows = await this.sql`SELECT document FROM handshake_records WHERE id = ${id}`; return rows[0] ? rows[0].document as HandshakeRecord : null; }
  async list(org: string, cursor?: string, limit = 25) { const rows = cursor ? await this.sql`SELECT document FROM handshake_records WHERE (claimant_organization_id = ${org} OR recipient_organization_id = ${org}) AND id < ${cursor} ORDER BY created_at DESC LIMIT ${Math.min(limit, 100)}` : await this.sql`SELECT document FROM handshake_records WHERE claimant_organization_id = ${org} OR recipient_organization_id = ${org} ORDER BY created_at DESC LIMIT ${Math.min(limit, 100)}`; const records = rows.map((row) => row.document as HandshakeRecord); return { records, ...(records.length === Math.min(limit, 100) ? { nextCursor: records.at(-1)?.id } : {}) }; }
  async write(record: HandshakeRecord, expectedVersion: number) { const rows = await this.sql`UPDATE handshake_records SET status = ${record.status}, expires_at = ${record.dataScope.validUntil}, version = ${expectedVersion + 1}, document = ${JSON.stringify({ ...record, version: expectedVersion + 1 })}::jsonb, updated_at = now() WHERE id = ${record.id} AND version = ${expectedVersion} RETURNING id`; return rows.length === 1; }
  async getKey(id: string) { const rows = await this.sql`SELECT id, organization_id, roles, secret_hash, revoked_at FROM api_keys WHERE id = ${id}`; if (!rows[0]) return null; const row = rows[0]; return { id: row.id, organizationId: row.organization_id, roles: row.roles, secretHash: row.secret_hash, ...(row.revoked_at ? { revokedAt: new Date(row.revoked_at).toISOString() } : {}) }; }
  async readPassport(organizationId: string, claimantId: string) { await this.ensurePassportSchema(); const rows = await this.sql`SELECT claimant_organization_id, claimant_id, version, sealed_profile, updated_at FROM passport_profiles WHERE claimant_organization_id = ${organizationId} AND claimant_id = ${claimantId}`; if (!rows[0]) return null; const row = rows[0]; return { claimantOrganizationId: row.claimant_organization_id, claimantId: row.claimant_id, version: row.version, sealedProfile: row.sealed_profile as SealedValue, updatedAt: new Date(row.updated_at).toISOString() }; }
  async writePassport(record: PassportRecord, expectedVersion: number) { await this.ensurePassportSchema(); if (expectedVersion === 0) { const rows = await this.sql`INSERT INTO passport_profiles (claimant_organization_id, claimant_id, version, sealed_profile, updated_at) VALUES (${record.claimantOrganizationId}, ${record.claimantId}, ${record.version}, ${JSON.stringify(record.sealedProfile)}::jsonb, ${record.updatedAt}) ON CONFLICT DO NOTHING RETURNING claimant_id`; return rows.length === 1; } const rows = await this.sql`UPDATE passport_profiles SET version = ${record.version}, sealed_profile = ${JSON.stringify(record.sealedProfile)}::jsonb, updated_at = ${record.updatedAt} WHERE claimant_organization_id = ${record.claimantOrganizationId} AND claimant_id = ${record.claimantId} AND version = ${expectedVersion} RETURNING claimant_id`; return rows.length === 1; }
}

export function hashApiKey(secret: string): string { const pepper = process.env.API_KEY_PEPPER; if (!pepper) throw new ApiError(500, "misconfigured", "API key verification is not configured."); return createHmac("sha256", pepper).update(secret).digest("base64url"); }

export async function authenticate(store: HandshakeStore, authorization: string | null): Promise<ApiPrincipal> {
  const token = authorization?.match(/^Bearer hsk_([A-Za-z0-9_-]+)_([A-Za-z0-9_-]+)$/); if (!token) throw new ApiError(401, "unauthorized", "A valid bearer API key is required.");
  const key = await store.getKey(token[1]); if (!key || key.revokedAt) throw new ApiError(401, "unauthorized", "A valid bearer API key is required.");
  const actual = Buffer.from(hashApiKey(token[2])); const expected = Buffer.from(key.secretHash); if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw new ApiError(401, "unauthorized", "A valid bearer API key is required.");
  return { organizationId: key.organizationId, roles: key.roles, keyId: key.id };
}

export class HandshakeService {
  readonly store: HandshakeStore; private readonly cipher: ValueCipher; private readonly now: () => Date;
  constructor(store: HandshakeStore, cipher: ValueCipher, now = () => new Date()) { this.store = store; this.cipher = cipher; this.now = now; }
  async create(principal: ApiPrincipal, input: unknown) {
    requireRole(principal, "claimant"); const body = record(input); const claimantId = text(body.claimantId, "claimantId"); const recipientOrganizationId = text(body.recipientOrganizationId, "recipientOrganizationId"); const recipient = party(body.recipient, "recipient"); const summary = text(body.summary, "summary"); const dataScope = scope(body.dataScope);
    const at = this.now().toISOString(); const request = event("request", `handshake-${randomUUID()}`, `event-${randomUUID()}`, at, { id: claimantId, role: "claimant" }, dataScope, { recipient, summary });
    const value: HandshakeRecord = { id: request.handshakeId, version: 1, status: "pending", claimantOrganizationId: principal.organizationId, recipientOrganizationId, claimantId, recipient, dataScope, events: [request], sealedValues: {}, createdAt: at, updatedAt: at };
    await this.store.create(value); return publicRecord(value);
  }
  async consent(principal: ApiPrincipal, id: string, input: unknown) {
    requireRole(principal, "claimant"); const body = record(input); const choice = body.choice === "approve" || body.choice === "deny" ? body.choice : fail(422, "invalid_request", "choice must be approve or deny."); const current = await this.requireOwned(id, principal.organizationId, "claimant"); if (current.status !== "pending") fail(409, "invalid_state", "Only a pending handshake can be consented.");
    const at = this.now().toISOString(); const consent = event("consent", current.id, `event-${randomUUID()}`, at, { id: current.claimantId, role: "claimant" }, current.dataScope, { recipientId: current.recipient.id, choice });
    const sealedValues: Record<string, SealedValue> = {};
    if (choice === "approve") { const values = record(body.values); const expected = new Set(current.dataScope.fields.map((field) => field.id)); if (Object.keys(values).length !== expected.size || Object.keys(values).some((key) => !expected.has(key))) fail(422, "invalid_request", "values must contain exactly the approved scoped fields."); for (const [fieldId, value] of Object.entries(values)) sealedValues[fieldId] = await this.cipher.seal(value, context(current, fieldId)); }
    const next = { ...current, status: choice === "approve" ? "active" as const : "denied" as const, events: [...current.events, consent], sealedValues, updatedAt: at }; await this.save(next, current.version); return publicRecord({ ...next, version: current.version + 1 });
  }
  async get(principal: ApiPrincipal, id: string) { const current = await this.requireParticipant(id, principal.organizationId); return publicRecord(await this.expireIfNeeded(current)); }
  async list(principal: ApiPrincipal, cursor?: string, limit?: number) { const page = await this.store.list(principal.organizationId, cursor, limit); return { data: await Promise.all(page.records.map(async (r) => publicRecord(await this.expireIfNeeded(r)))), ...(page.nextCursor ? { nextCursor: page.nextCursor } : {}) }; }
  async getPassport(principal: ApiPrincipal, claimantId: string) { requireRole(principal, "claimant"); const id = text(claimantId, "claimantId"); const stored = await this.store.readPassport(principal.organizationId, id); if (!stored) fail(404, "not_found", "Passport was not found."); const profile = await this.cipher.open(stored.sealedProfile, passportContext(principal.organizationId, id)); return { ...(profile as Omit<PassportProfile, "version">), version: stored.version, updatedAt: stored.updatedAt } as PassportProfile; }
  async putPassport(principal: ApiPrincipal, input: unknown) { requireRole(principal, "claimant"); const body = record(input); const claimantId = text(body.claimantId, "claimantId"); const constraints = passportConstraints(body.constraints); const current = await this.store.readPassport(principal.organizationId, claimantId); const version = (current?.version ?? 0) + 1; const updatedAt = this.now().toISOString(); const profile = { claimantId, constraints, version, updatedAt }; const sealedProfile = await this.cipher.seal(profile, passportContext(principal.organizationId, claimantId)); const saved = await this.store.writePassport({ claimantOrganizationId: principal.organizationId, claimantId, version, sealedProfile, updatedAt }, current?.version ?? 0); if (!saved) fail(409, "write_conflict", "The passport changed concurrently. Retry the request."); return profile; }
  async grant(principal: ApiPrincipal, id: string) { requireRole(principal, "recipient"); const current = await this.requireOwned(id, principal.organizationId, "recipient"); const active = await this.expireIfNeeded(current); if (active.status !== "active" || Date.parse(active.dataScope.validFrom) > this.now().getTime()) fail(409, "grant_inactive", "The scoped grant is not active."); const values: Record<string, unknown> = {}; for (const field of active.dataScope.fields) values[field.id] = await this.cipher.open(active.sealedValues[field.id], context(active, field.id)); return { handshakeId: active.id, dataScope: active.dataScope, values }; }
  async decision(principal: ApiPrincipal, id: string, input: unknown) { requireRole(principal, "recipient"); const current = await this.requireOwned(id, principal.organizationId, "recipient"); const active = await this.expireIfNeeded(current); if (active.status !== "active") fail(409, "grant_inactive", "The scoped grant is not active."); if (active.events.some((e) => e.type === "decision")) fail(409, "invalid_state", "A recipient decision already exists."); const body = record(input); const response = body.response; if (!["accept", "required_change", "decline", "cannot_determine"].includes(String(response))) fail(422, "invalid_request", "response is invalid."); const rationale = text(body.rationale, "rationale"); const requiredChanges = response === "required_change" ? stringList(body.requiredChanges, "requiredChanges") : undefined; const decision = event("decision", active.id, `event-${randomUUID()}`, this.now().toISOString(), { id: text(body.actorId, "actorId"), role: "recipient" }, active.dataScope, { response, rationale, ...(requiredChanges ? { requiredChanges } : {}) }); const next = { ...active, events: [...active.events, decision], updatedAt: decision.occurredAt }; await this.save(next, active.version); return { event: decision }; }
  async acknowledge(principal: ApiPrincipal, id: string, input: unknown) { requireRole(principal, "recipient"); const current = await this.requireOwned(id, principal.organizationId, "recipient"); const active = await this.expireIfNeeded(current); if (active.status !== "active") fail(409, "grant_inactive", "The scoped grant is not active."); const decision = active.events.find((e) => e.type === "decision"); if (!decision) fail(409, "invalid_state", "A decision is required before acknowledgement."); if (active.events.some((e) => e.type === "acknowledgement")) fail(409, "invalid_state", "An acknowledgement already exists."); const body = record(input); const outcome = body.outcome === "acknowledged" || body.outcome === "rejected" ? body.outcome : fail(422, "invalid_request", "outcome is invalid."); const acknowledgement = event("acknowledgement", active.id, `event-${randomUUID()}`, this.now().toISOString(), { id: text(body.actorId, "actorId"), role: "acknowledger", roleName: text(body.roleName, "roleName") }, active.dataScope, { decisionEventId: decision.eventId, outcome, ...(typeof body.note === "string" && body.note.trim() ? { note: body.note.trim() } : {}) }); const receipt = event("receipt", active.id, `event-${randomUUID()}`, acknowledgement.occurredAt, { id: "handshake-api", role: "system" }, active.dataScope, { deliveredTo: [{ id: active.claimantId, role: "claimant" }, { id: active.recipient.id, role: "recipient" }], eventIds: [...active.events, acknowledgement].map((e) => e.eventId) }); const next = { ...active, events: [...active.events, acknowledgement, receipt], updatedAt: acknowledgement.occurredAt }; await this.save(next, active.version); return { acknowledgement, receipt }; }
  async revoke(principal: ApiPrincipal, id: string, input: unknown) { requireRole(principal, "claimant"); const current = await this.requireOwned(id, principal.organizationId, "claimant"); const active = await this.expireIfNeeded(current); if (active.status !== "active") fail(409, "grant_inactive", "Only an active grant can be revoked."); const body = record(input); const revocation = event("revocation", active.id, `event-${randomUUID()}`, this.now().toISOString(), { id: active.claimantId, role: "claimant" }, active.dataScope, { reason: text(body.reason, "reason") }); const next = { ...active, status: "revoked" as const, sealedValues: {}, events: [...active.events, revocation], updatedAt: revocation.occurredAt }; await this.save(next, active.version); return publicRecord({ ...next, version: active.version + 1 }); }
  private async requireParticipant(id: string, org: string) { const current = await this.store.read(id); if (!current) fail(404, "not_found", "Handshake was not found."); if (current.claimantOrganizationId !== org && current.recipientOrganizationId !== org) fail(404, "not_found", "Handshake was not found."); return current; }
  private async requireOwned(id: string, org: string, role: "claimant" | "recipient") { const current = await this.requireParticipant(id, org); if ((role === "claimant" ? current.claimantOrganizationId : current.recipientOrganizationId) !== org) fail(403, "forbidden", "The authenticated organization cannot perform this action."); return current; }
  private async expireIfNeeded(current: HandshakeRecord) { if (current.status !== "active" || Date.parse(current.dataScope.validUntil) > this.now().getTime()) return current; const expiry = event("expiry", current.id, `event-${randomUUID()}`, this.now().toISOString(), { id: "handshake-api", role: "system" }, current.dataScope, { reason: "duration_elapsed" }); const next = { ...current, status: "expired" as const, sealedValues: {}, events: [...current.events, expiry], updatedAt: expiry.occurredAt }; await this.save(next, current.version); return { ...next, version: current.version + 1 }; }
  private async save(next: HandshakeRecord, version: number) { if (!await this.store.write(next, version)) throw new ApiError(409, "write_conflict", "The handshake changed concurrently. Retry the request."); }
}

function publicRecord(record: HandshakeRecord) { const { sealedValues: _sealed, ...safe } = record; return safe; }
function context(record: HandshakeRecord, fieldId: string) { return { handshakeId: record.id, fieldId, claimantOrganizationId: record.claimantOrganizationId, recipientOrganizationId: record.recipientOrganizationId }; }
function passportContext(claimantOrganizationId: string, claimantId: string) { return { recordType: "passport", claimantOrganizationId, claimantId }; }
function event(type: HandshakeEvent["type"], handshakeId: string, eventId: string, occurredAt: string, actor: HandshakeEvent["actor"], dataScope: HandshakeDataScope, payload: any): HandshakeEvent { const value = { schemaVersion: HANDSHAKE_EVENT_SCHEMA_VERSION, eventId, handshakeId, type, occurredAt, actor, dataScope, result: { status: "succeeded", failureCondition: null }, payload } as HandshakeEvent; const valid = validateHandshakeEvent(value); if (!valid.success) throw new ApiError(500, "invalid_event", "Internal event validation failed.", valid.issues); return value; }
function requireRole(principal: ApiPrincipal, role: ApiRole) { if (!principal.roles.includes(role)) fail(403, "forbidden", "The API key lacks the required role."); }
function record(value: unknown): Record<string, any> { if (!value || typeof value !== "object" || Array.isArray(value)) fail(422, "invalid_request", "Request body must be a JSON object."); return value as Record<string, any>; }
function text(value: unknown, name: string): string { if (typeof value !== "string" || !value.trim()) fail(422, "invalid_request", `${name} must be a non-empty string.`); return value.trim(); }
function party(value: unknown, name: string): PartyReference { const data = record(value); return { id: text(data.id, `${name}.id`), displayName: text(data.displayName, `${name}.displayName`) }; }
function scope(value: unknown): HandshakeDataScope { const data = record(value); const eventScope = { purpose: text(data.purpose, "dataScope.purpose"), fields: Array.isArray(data.fields) ? data.fields.map((field, index) => { const item = record(field); return { id: text(item.id, `dataScope.fields[${index}].id`), label: text(item.label, `dataScope.fields[${index}].label`) }; }) : fail(422, "invalid_request", "dataScope.fields must be an array."), validFrom: text(data.validFrom, "dataScope.validFrom"), validUntil: text(data.validUntil, "dataScope.validUntil") }; const candidate = { schemaVersion: HANDSHAKE_EVENT_SCHEMA_VERSION, eventId: "event-validation", handshakeId: "handshake-validation", type: "request", occurredAt: eventScope.validFrom, actor: { id: "validation", role: "claimant" }, dataScope: eventScope, result: { status: "succeeded", failureCondition: null }, payload: { recipient: { id: "recipient", displayName: "Recipient" }, summary: "validation" } }; const check = validateHandshakeEvent(candidate); if (!check.success) throw new ApiError(422, "invalid_request", "dataScope is invalid.", check.issues); if (Date.parse(eventScope.validUntil) - Date.parse(eventScope.validFrom) > 24 * 60 * 60 * 1000) fail(422, "invalid_request", "dataScope must not grant access for more than 24 hours."); return eventScope; }
function stringList(value: unknown, name: string): string[] { if (!Array.isArray(value) || value.length === 0 || value.some((item) => typeof item !== "string" || !item.trim())) fail(422, "invalid_request", `${name} must be a non-empty array of strings.`); return value.map((item) => item.trim()); }
function passportConstraints(value: unknown): PassportConstraint[] { if (!Array.isArray(value) || value.length > 50) fail(422, "invalid_request", "constraints must be an array with at most 50 items."); const ids = new Set<string>(); return value.map((entry, index) => { const item = record(entry); const id = text(item.id, `constraints[${index}].id`); if (!/^order\.(constraint|preference)\.[a-z0-9][a-z0-9._-]*$/.test(id) || ids.has(id)) fail(422, "invalid_request", `constraints[${index}].id is invalid or duplicated.`); ids.add(id); const label = text(item.label, `constraints[${index}].label`); if (label.length > 120) fail(422, "invalid_request", `constraints[${index}].label is too long.`); const severity = item.severity; if (severity !== "severe" && severity !== "moderate" && severity !== "mild") fail(422, "invalid_request", `constraints[${index}].severity is invalid.`); if (typeof item.crossContaminationTolerance !== "boolean") fail(422, "invalid_request", `constraints[${index}].crossContaminationTolerance must be boolean.`); return { id, label, severity, crossContaminationTolerance: item.crossContaminationTolerance }; }); }
function fail(status: number, code: string, message: string): never { throw new ApiError(status, code, message); }
