#!/usr/bin/env node

/**
 * Version Bump Script
 * Updates version numbers across all package.json files
 *
 * Usage:
 *   node scripts/version-bump.js <version>
 *   node scripts/version-bump.js 1.2.3
 *   node scripts/version-bump.js 1.2.3-rc.1
 */

const fs = require("fs");
const path = require("path");

const version = process.argv[2];

if (!version) {
  console.error("Error: Version number required");
  console.error("Usage: node scripts/version-bump.js <version>");
  console.error("Example: node scripts/version-bump.js 1.2.3");
  process.exit(1);
}

// Validate SemVer format
const semverRegex =
  /^(\d+)\.(\d+)\.(\d+)(?:-([\da-z\-]+(?:\.[\da-z\-]+)*))?(?:\+([\da-z\-]+(?:\.[\da-z\-]+)*))?$/i;
if (!semverRegex.test(version)) {
  console.error(`Error: Invalid version format: ${version}`);
  console.error("Version must follow SemVer 2.0.0 (e.g., 1.2.3 or 1.2.3-rc.1)");
  process.exit(1);
}

const packageFiles = ["package.json", "server/package.json", "client/package.json"];

console.log(`Updating version to ${version}...\n`);

packageFiles.forEach((file) => {
  const filePath = path.join(process.cwd(), file);

  if (!fs.existsSync(filePath)) {
    console.warn(`Warning: ${file} not found, skipping`);
    return;
  }

  try {
    const packageJson = JSON.parse(fs.readFileSync(filePath, "utf8"));
    const oldVersion = packageJson.version;
    packageJson.version = version;

    fs.writeFileSync(filePath, JSON.stringify(packageJson, null, 2) + "\n");
    console.log(`✓ Updated ${file}: ${oldVersion} → ${version}`);
  } catch (error) {
    console.error(`Error updating ${file}:`, error.message);
    process.exit(1);
  }
});

console.log(`\n✓ Version updated to ${version} in all package.json files`);

// Update version in Dockerfile if it exists
const dockerfilePath = path.join(process.cwd(), "Dockerfile");
if (fs.existsSync(dockerfilePath)) {
  try {
    let dockerfile = fs.readFileSync(dockerfilePath, "utf8");
    // Update any version references in Dockerfile
    dockerfile = dockerfile.replace(/ENV.*VERSION.*=.*/g, `ENV VERSION=${version}`);
    fs.writeFileSync(dockerfilePath, dockerfile);
    console.log(`✓ Updated Dockerfile version`);
  } catch (error) {
    console.warn(`Warning: Could not update Dockerfile: ${error.message}`);
  }
}

console.log("\nNext steps:");
console.log("1. Review the changes");
console.log("2. Update CHANGELOG.md");
console.log(
  '3. Commit changes: git add -A && git commit -m "chore: bump version to ' + version + '"'
);
console.log("4. Create tag: git tag -a v" + version + ' -m "Release v' + version + '"');
console.log("5. Push: git push && git push --tags");
