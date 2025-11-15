#!/usr/bin/env node

/**
 * Release Validation Script
 * Validates that a release is ready
 *
 * Usage:
 *   node scripts/validate-release.js
 */

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

let errors = [];
let warnings = [];

console.log("🔍 Validating release readiness...\n");

// Check version consistency
console.log("Checking version consistency...");
const packageFiles = [
  { path: "package.json", name: "root" },
  { path: "server/package.json", name: "server" },
  { path: "client/package.json", name: "client" },
];

const versions = {};
packageFiles.forEach((file) => {
  const filePath = path.join(process.cwd(), file.path);
  if (fs.existsSync(filePath)) {
    try {
      const packageJson = JSON.parse(fs.readFileSync(filePath, "utf8"));
      versions[file.name] = packageJson.version;
    } catch (error) {
      errors.push(`Failed to read ${file.path}: ${error.message}`);
    }
  } else {
    warnings.push(`${file.path} not found`);
  }
});

const uniqueVersions = [...new Set(Object.values(versions))];
if (uniqueVersions.length > 1) {
  errors.push(`Version mismatch: ${JSON.stringify(versions)}`);
} else if (uniqueVersions.length === 1) {
  console.log(`✓ All versions match: ${uniqueVersions[0]}`);
} else {
  errors.push("No versions found");
}

// Check CHANGELOG
console.log("\nChecking CHANGELOG.md...");
const changelogPath = path.join(process.cwd(), "CHANGELOG.md");
if (fs.existsSync(changelogPath)) {
  const changelog = fs.readFileSync(changelogPath, "utf8");
  const currentVersion = uniqueVersions[0];

  if (changelog.includes(`[${currentVersion}]`) || changelog.includes(`## [${currentVersion}]`)) {
    console.log(`✓ CHANGELOG.md contains entry for ${currentVersion}`);
  } else {
    warnings.push(`CHANGELOG.md may not have entry for ${currentVersion}`);
  }
} else {
  warnings.push("CHANGELOG.md not found");
}

// Check for uncommitted changes
console.log("\nChecking git status...");
try {
  const status = execSync("git status --porcelain", { encoding: "utf8" });
  if (status.trim()) {
    warnings.push("There are uncommitted changes");
    console.log("⚠ Uncommitted changes detected");
  } else {
    console.log("✓ No uncommitted changes");
  }
} catch (error) {
  warnings.push("Could not check git status");
}

// Check if tests pass
console.log("\nChecking tests...");
try {
  console.log("Running server tests...");
  execSync("cd server && npm test -- --passWithNoTests", { stdio: "inherit" });
  console.log("✓ Server tests passed");
} catch (error) {
  errors.push("Server tests failed");
}

try {
  console.log("Running client tests...");
  execSync("cd client && npm test -- --passWithNoTests --watchAll=false", { stdio: "inherit" });
  console.log("✓ Client tests passed");
} catch (error) {
  errors.push("Client tests failed");
}

// Check for build
console.log("\nChecking build...");
try {
  console.log("Building client...");
  execSync("cd client && npm run build", { stdio: "inherit" });
  console.log("✓ Build successful");
} catch (error) {
  errors.push("Build failed");
}

// Summary
console.log("\n" + "=".repeat(50));
console.log("Validation Summary");
console.log("=".repeat(50));

if (errors.length === 0 && warnings.length === 0) {
  console.log("✅ Release is ready!");
  process.exit(0);
} else {
  if (errors.length > 0) {
    console.log(`\n❌ Errors (${errors.length}):`);
    errors.forEach((error) => console.log(`  - ${error}`));
  }

  if (warnings.length > 0) {
    console.log(`\n⚠️  Warnings (${warnings.length}):`);
    warnings.forEach((warning) => console.log(`  - ${warning}`));
  }

  if (errors.length > 0) {
    console.log("\n❌ Release validation failed. Please fix errors before releasing.");
    process.exit(1);
  } else {
    console.log("\n⚠️  Release validation completed with warnings. Review before releasing.");
    process.exit(0);
  }
}
