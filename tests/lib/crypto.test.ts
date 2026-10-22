import { describe, it, expect } from "vitest";
import { encrypt, decrypt } from "../../lib/crypto";

describe("crypto", () => {
  it("encrypt then decrypt returns the original plaintext", () => {
    const original = "ya29.a0AfH6SMC...";
    const ciphertext = encrypt(original);
    expect(ciphertext).not.toBe(original);
    expect(decrypt(ciphertext)).toBe(original);
  });

  it("ciphertext is never a substring of the plaintext token", () => {
    const original = "ya29.a0AfH6SMC-sensitive-token";
    expect(encrypt(original)).not.toContain(original);
  });
});
