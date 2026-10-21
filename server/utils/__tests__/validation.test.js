/**
 * Validation utility tests
 */

const { validateRequiredFields, validatePathComponent, isValidEmail } = require("../validation");

describe("Validation Utilities", () => {
  describe("validateRequiredFields", () => {
    it("should return null when all required fields are present", () => {
      const body = { field1: "value1", field2: "value2" };
      const requiredFields = ["field1", "field2"];
      expect(validateRequiredFields(body, requiredFields)).toBeNull();
    });

    it("should return error when fields are missing", () => {
      const body = { field1: "value1" };
      const requiredFields = ["field1", "field2"];
      const result = validateRequiredFields(body, requiredFields);
      expect(result).not.toBeNull();
      expect(result.error).toContain("Missing required fields");
      expect(result.missingFields).toContain("field2");
    });

    it("should accept falsy values like 0, false and empty string", () => {
      const body = { zero: 0, no: false, empty: "" };
      expect(validateRequiredFields(body, ["zero", "no", "empty"])).toBeNull();
    });
  });

  describe("validatePathComponent", () => {
    it("should return valid for safe alphanumeric components", () => {
      expect(validatePathComponent("avatar")).toEqual({ valid: true, sanitized: "avatar" });
      expect(validatePathComponent("user-1_2")).toEqual({ valid: true, sanitized: "user-1_2" });
      expect(validatePathComponent(42)).toEqual({ valid: true, sanitized: "42" });
    });

    it("should reject null and undefined", () => {
      expect(validatePathComponent(null).valid).toBe(false);
      expect(validatePathComponent(undefined).valid).toBe(false);
    });

    it("should reject path traversal and invalid characters", () => {
      expect(validatePathComponent("../etc/passwd").valid).toBe(false);
      expect(validatePathComponent("a/b").valid).toBe(false);
      expect(validatePathComponent("a%2eb").valid).toBe(false);
      expect(validatePathComponent("padded ").valid).toBe(false);
      expect(validatePathComponent("bad!char").valid).toBe(false);
      expect(validatePathComponent("").valid).toBe(false);
    });
  });

  describe("isValidEmail", () => {
    it("should return true for valid email addresses", () => {
      expect(isValidEmail("user@example.com")).toBe(true);
      expect(isValidEmail("first.last+tag@sub.example.co.uk")).toBe(true);
    });

    it("should return false for invalid email addresses", () => {
      expect(isValidEmail("")).toBe(false);
      expect(isValidEmail(null)).toBe(false);
      expect(isValidEmail(undefined)).toBe(false);
      expect(isValidEmail("not-an-email")).toBe(false);
      expect(isValidEmail("user@")).toBe(false);
      expect(isValidEmail("@example.com")).toBe(false);
    });

    it("should reject excessively long inputs", () => {
      const longLocal = "a".repeat(250);
      expect(isValidEmail(`${longLocal}@example.com`)).toBe(false);
    });
  });
});
