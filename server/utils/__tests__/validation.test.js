/**
 * Validation utility tests
 */

const {
  validateRequiredFields,
  isValidContainerId,
  isValidEndpointId,
  isValidImageName,
  isValidPortainerUrl,
  validateImageArray,
  validateContainerArray,
} = require("../validation");

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
  });

  describe("isValidContainerId", () => {
    it("should return true for valid container ID", () => {
      expect(isValidContainerId("abc123def456")).toBe(true);
      expect(isValidContainerId("a".repeat(12))).toBe(true);
    });

    it("should return false for invalid container ID", () => {
      expect(isValidContainerId("")).toBe(false);
      expect(isValidContainerId("abc")).toBe(false);
      expect(isValidContainerId(null)).toBe(false);
      expect(isValidContainerId(undefined)).toBe(false);
    });
  });

  describe("isValidEndpointId", () => {
    it("should return true for valid endpoint ID", () => {
      expect(isValidEndpointId(1)).toBe(true);
      expect(isValidEndpointId("1")).toBe(true);
      expect(isValidEndpointId(0)).toBe(true);
    });

    it("should return false for invalid endpoint ID", () => {
      expect(isValidEndpointId(null)).toBe(false);
      expect(isValidEndpointId(undefined)).toBe(false);
    });
  });

  describe("isValidImageName", () => {
    it("should return true for valid image name", () => {
      expect(isValidImageName("nginx:latest")).toBe(true);
      expect(isValidImageName("myimage")).toBe(true);
    });

    it("should return false for invalid image name", () => {
      expect(isValidImageName("")).toBe(false);
      expect(isValidImageName(null)).toBe(false);
      expect(isValidImageName(undefined)).toBe(false);
    });
  });

  describe("isValidPortainerUrl", () => {
    it("should return true for valid URLs", () => {
      expect(isValidPortainerUrl("http://localhost:9000")).toBe(true);
      expect(isValidPortainerUrl("https://portainer.example.com")).toBe(true);
    });

    it("should return false for invalid URLs", () => {
      expect(isValidPortainerUrl("not-a-url")).toBe(false);
      expect(isValidPortainerUrl("ftp://example.com")).toBe(false);
      expect(isValidPortainerUrl("")).toBe(false);
    });
  });

  describe("validateImageArray", () => {
    it("should return null for valid image array", () => {
      const images = [{ id: "img1", portainerUrl: "http://localhost:9000", endpointId: 1 }];
      expect(validateImageArray(images)).toBeNull();
    });

    it("should return error for empty array", () => {
      expect(validateImageArray([])).not.toBeNull();
      expect(validateImageArray(null)).not.toBeNull();
    });

    it("should return error for images with missing fields", () => {
      const images = [{ id: "img1" }];
      const result = validateImageArray(images);
      expect(result).not.toBeNull();
      expect(result.error).toContain("id, portainerUrl, and endpointId");
    });
  });

  describe("validateContainerArray", () => {
    it("should return null for valid container array", () => {
      const containers = [
        {
          containerId: "abc123def456", // At least 12 characters required
          endpointId: 1,
          imageName: "nginx:latest",
          portainerUrl: "http://localhost:9000",
        },
      ];
      expect(validateContainerArray(containers)).toBeNull();
    });

    it("should return error for empty array", () => {
      expect(validateContainerArray([])).not.toBeNull();
    });

    it("should return error for containers with missing fields", () => {
      const containers = [{ containerId: "abc123def456" }];
      const result = validateContainerArray(containers);
      expect(result).not.toBeNull();
      expect(result.error).toContain("Validation failed");
      expect(result.errors).toBeDefined();
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0].error).toContain("containerId, endpointId, imageName, and portainerUrl");
    });
  });
});
