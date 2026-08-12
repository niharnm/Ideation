import {
  AwsKmsEnvelopeCipher,
  HandshakeService,
  LocalEnvelopeCipher,
  MemoryHandshakeStore,
  PostgresHandshakeStore,
  hashApiKey,
  type ApiPrincipal,
  type HandshakeStore,
  type ValueCipher,
} from "../../src/api/service.ts";

let store: HandshakeStore | undefined;
let cipher: ValueCipher | undefined;
let service: HandshakeService | undefined;
let demoService: HandshakeService | undefined;

export function getService(): HandshakeService {
  if (!service) {
    store = process.env.DATABASE_URL ? new PostgresHandshakeStore() : new MemoryHandshakeStore();
    cipher = process.env.AWS_KMS_KEY_ID
      ? new AwsKmsEnvelopeCipher(process.env.AWS_KMS_KEY_ID)
      : new LocalEnvelopeCipher();
    if (process.env.NODE_ENV === "production" && (!process.env.DATABASE_URL || !process.env.AWS_KMS_KEY_ID || !process.env.AWS_ROLE_ARN || !process.env.API_KEY_PEPPER)) {
      throw new Error("Production API requires DATABASE_URL, AWS_KMS_KEY_ID, AWS_ROLE_ARN, and API_KEY_PEPPER.");
    }
    service = new HandshakeService(store, cipher);
  }
  return service;
}

export function getDemoService(): HandshakeService {
  if (!demoService) {
    demoService = new HandshakeService(
      new MemoryHandshakeStore(),
      new LocalEnvelopeCipher(),
    );
  }
  return demoService;
}

export async function demoPrincipal(role: "claimant" | "recipient"): Promise<ApiPrincipal> {
  const organizationId = role === "claimant" ? "demo-claimant" : "demo-recipient";
  return { organizationId, keyId: `demo-${role}`, roles: role === "claimant" ? ["claimant"] : ["recipient"] };
}

export function seedDevelopmentKey(id: string, organizationId: string, roles: ApiPrincipal["roles"], secret: string) {
  if (process.env.DATABASE_URL || !(store instanceof MemoryHandshakeStore)) return;
  store.keys.set(id, { id, organizationId, roles, secretHash: hashApiKey(secret) });
}
