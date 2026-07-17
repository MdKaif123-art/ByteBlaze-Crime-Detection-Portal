const ENCRYPTION_PREFIX = "enc:v1:";
const HARD_CODED_CIPHER_KEY = "rescuemesh-hardcoded-key-2026";

function utf8ToBytes(value) {
  return new TextEncoder().encode(value);
}

function bytesToUtf8(value) {
  return new TextDecoder().decode(value);
}

function base64ToBytes(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

async function deriveAesKey(secret) {
  const digest = await crypto.subtle.digest("SHA-256", utf8ToBytes(secret));
  return crypto.subtle.importKey("raw", digest, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

export async function decryptText(encryptedText) {
  const secret = HARD_CODED_CIPHER_KEY;
  if (!encryptedText?.startsWith(ENCRYPTION_PREFIX)) return encryptedText;

  const encoded = encryptedText.slice(ENCRYPTION_PREFIX.length);
  const [ivPart, cipherPart] = encoded.split(":");
  if (!ivPart || !cipherPart) throw new Error("Invalid encrypted payload format");

  const key = await deriveAesKey(secret);
  const plainBuffer = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: base64ToBytes(ivPart) },
    key,
    base64ToBytes(cipherPart)
  );

  return bytesToUtf8(plainBuffer);
}

export async function decryptTextSafe(value) {
  if (!value) return value || "";
  try {
    return await decryptText(value);
  } catch {
    return value;
  }
}

export async function deepDecryptObject(value) {
  if (Array.isArray(value)) {
    const next = [];
    for (const item of value) next.push(await deepDecryptObject(item));
    return next;
  }
  if (value && typeof value === "object") {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = await deepDecryptObject(v);
    }
    return out;
  }
  if (typeof value === "string" && value.startsWith(ENCRYPTION_PREFIX)) {
    return decryptTextSafe(value);
  }
  return value;
}
