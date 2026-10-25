import { describe, expect, it } from "vitest";
import { decryptPendingPayload, encryptPendingPayload } from "@/lib/auth/pending-signup";

describe("pending-signup encryption helper", () => {
  it("encrypts and decrypts round-trip correctly", () => {
    const data = { email: "dana@example.com", password: "Password123!", exp: Date.now() + 60000 };
    const encrypted = encryptPendingPayload(data);
    expect(typeof encrypted).toBe("string");
    expect(encrypted.split(".")).toHaveLength(3);

    const decrypted = decryptPendingPayload<typeof data>(encrypted);
    expect(decrypted).toEqual(data);
  });

  it("fails gracefully on corrupted or tampered ciphertext", () => {
    const data = { email: "dana@example.com", password: "Password123!" };
    const encrypted = encryptPendingPayload(data);
    const [iv, tag, ciphertext] = encrypted.split(".");

    // Flip a byte in the tag
    const tagBuf = Buffer.from(tag, "base64url");
    tagBuf[0] ^= 1;
    const tamperedTag = `${iv}.${tagBuf.toString("base64url")}.${ciphertext}`;
    expect(decryptPendingPayload(tamperedTag)).toBeNull();

    // Flip a byte in the ciphertext
    const cipherBuf = Buffer.from(ciphertext, "base64url");
    cipherBuf[0] ^= 1;
    const tamperedCipher = `${iv}.${tag}.${cipherBuf.toString("base64url")}`;
    expect(decryptPendingPayload(tamperedCipher)).toBeNull();
  });

  it("fails gracefully on invalid formats or random strings", () => {
    expect(decryptPendingPayload("not.a.valid.token")).toBeNull();
    expect(decryptPendingPayload("random-string")).toBeNull();
    expect(decryptPendingPayload("")).toBeNull();
  });
});
