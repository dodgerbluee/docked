#!/usr/bin/env node

/**
 * Database Schema Documentation Generator
 * 
 * Generates markdown documentation for the SQLite database schema.
 * 
 * Usage:
 *   node server/scripts/generateSchemaDoc.js
 *   npm run docs:schema
 */

const sqlite3 = require("sqlite3").verbose();
const path = require("path");
const fs = require("fs");
const os = require("os");

// Get database path (same logic as database.js)
function getDataDir() {
  if (process.env.DATA_DIR) {
    return process.env.DATA_DIR;
  }
  if (process.env.NODE_ENV === "test") {
    return path.join(os.tmpdir(), "docked-test-data");
  }
  return "/data";
}

const DATA_DIR = getDataDir();
const DB_PATH = path.join(DATA_DIR, "users.db");
const OUTPUT_PATH = path.join(__dirname, "../../docs/DATABASE_SCHEMA.md");

/**
 * Get all tables from the database
 */
function getTables(db) {
  return new Promise((resolve, reject) => {
    db.all(
      `SELECT name, sql 
       FROM sqlite_master 
       WHERE type='table' AND name NOT LIKE 'sqlite_%'
       ORDER BY name`,
      [],
      (err, rows) => {
        if (err) {
          reject(err);
        } else {
          resolve(rows || []);
        }
      }
    );
  });
}

/**
 * Get column information for a table
 */
function getTableInfo(db, tableName) {
  return new Promise((resolve, reject) => {
    db.all(`PRAGMA table_info(${tableName})`, [], (err, rows) => {
      if (err) {
        reject(err);
      } else {
        resolve(rows || []);
      }
    });
  });
}

/**
 * Get indexes for a table
 */
function getIndexes(db, tableName) {
  return new Promise((resolve, reject) => {
    db.all(
      `SELECT name, sql 
       FROM sqlite_master 
       WHERE type='index' AND tbl_name = ? AND name NOT LIKE 'sqlite_%'
       ORDER BY name`,
      [tableName],
      (err, rows) => {
        if (err) {
          reject(err);
        } else {
          resolve(rows || []);
        }
      }
    );
  });
}

/**
 * Get foreign keys for a table
 */
function getForeignKeys(db, tableName) {
  return new Promise((resolve, reject) => {
    db.all(`PRAGMA foreign_key_list(${tableName})`, [], (err, rows) => {
      if (err) {
        reject(err);
      } else {
        resolve(rows || []);
      }
    });
  });
}

/**
 * Format column type with constraints
 */
function formatColumn(col) {
  let result = `**${col.name}**`;
  result += ` \`${col.type}\``;
  
  if (col.notnull === 1) {
    result += " NOT NULL";
  }
  if (col.dflt_value !== null) {
    const defaultValue = col.dflt_value.replace(/^'|'$/g, "");
    result += ` DEFAULT ${defaultValue}`;
  }
  if (col.pk === 1) {
    result += " (PRIMARY KEY)";
  }
  
  return result;
}

/**
 * Generate markdown documentation
 */
async function generateDocumentation() {
  return new Promise((resolve, reject) => {
    // Check if database exists
    if (!fs.existsSync(DB_PATH)) {
      console.error(`Database not found at ${DB_PATH}`);
      console.error("Please ensure the database has been initialized.");
      process.exit(1);
    }

    const db = new sqlite3.Database(DB_PATH, (err) => {
      if (err) {
        reject(err);
        return;
      }

      (async () => {
        try {
          const tables = await getTables(db);
          const doc = [];

          // Header
          doc.push("# Database Schema Documentation");
          doc.push("");
          doc.push(`Generated on: ${new Date().toISOString()}`);
          doc.push(`Database: ${DB_PATH}`);
          doc.push("");
          doc.push("## Overview");
          doc.push("");
          doc.push(`This document describes the database schema for the Docked application.`);
          doc.push(`The database uses SQLite and contains ${tables.length} table(s).`);
          doc.push("");
          doc.push("## Tables");
          doc.push("");

          // Process each table
          for (const table of tables) {
            const tableName = table.name;
            const columns = await getTableInfo(db, tableName);
            const indexes = await getIndexes(db, tableName);
            const foreignKeys = await getForeignKeys(db, tableName);

            // Table header
            doc.push(`### \`${tableName}\``);
            doc.push("");
            
            // Table description (extract from SQL if available)
            if (table.sql) {
              doc.push("**SQL Definition:**");
              doc.push("```sql");
              doc.push(table.sql);
              doc.push("```");
              doc.push("");
            }

            // Columns
            doc.push("#### Columns");
            doc.push("");
            doc.push("| Column | Type | Constraints | Description |");
            doc.push("|--------|------|-------------|-------------|");
            
            for (const col of columns) {
              const constraints = [];
              if (col.pk === 1) constraints.push("PRIMARY KEY");
              if (col.notnull === 1) constraints.push("NOT NULL");
              if (col.dflt_value !== null) {
                const defaultValue = col.dflt_value.replace(/^'|'$/g, "");
                constraints.push(`DEFAULT ${defaultValue}`);
              }
              
              doc.push(`| ${col.name} | ${col.type} | ${constraints.join(", ") || "-"} | - |`);
            }
            doc.push("");

            // Indexes
            if (indexes.length > 0) {
              doc.push("#### Indexes");
              doc.push("");
              for (const idx of indexes) {
                if (idx.sql) {
                  doc.push(`- **${idx.name}**: \`${idx.sql}\``);
                } else {
                  doc.push(`- **${idx.name}**`);
                }
              }
              doc.push("");
            }

            // Foreign Keys
            if (foreignKeys.length > 0) {
              doc.push("#### Foreign Keys");
              doc.push("");
              for (const fk of foreignKeys) {
                doc.push(`- **${fk.from}** → \`${fk.table}.${fk.to}\``);
              }
              doc.push("");
            }

            doc.push("---");
            doc.push("");
          }

          // Relationships section
          doc.push("## Relationships");
          doc.push("");
          doc.push("### User-Centric Design");
          doc.push("");
          doc.push("The database follows a user-centric design where most tables are scoped to individual users:");
          doc.push("");
          doc.push("- `users` - Core user accounts");
          doc.push("- `portainer_instances` - Portainer instances per user (via `user_id`)");
          doc.push("- `tracked_images` - Tracked Docker images per user (via `user_id`)");
          doc.push("- `settings` - User-specific settings (via `user_id`)");
          doc.push("- `discord_webhooks` - Discord webhook configurations per user (via `user_id`)");
          doc.push("- `docker_hub_credentials` - Docker Hub credentials per user (via `user_id`)");
          doc.push("- `batch_config` - Batch job configurations per user (via `user_id`)");
          doc.push("- `batch_runs` - Batch job execution history per user (via `user_id`)");
          doc.push("");
          doc.push("### Special Cases");
          doc.push("");
          doc.push("- `settings` table uses `user_id = 0` for system-wide settings (e.g., log level)");
          doc.push("");

          // Write to file
          const outputDir = path.dirname(OUTPUT_PATH);
          if (!fs.existsSync(outputDir)) {
            fs.mkdirSync(outputDir, { recursive: true });
          }

          fs.writeFileSync(OUTPUT_PATH, doc.join("\n"), "utf8");
          console.log(`✅ Schema documentation generated: ${OUTPUT_PATH}`);
          console.log(`   Tables documented: ${tables.length}`);

          db.close((err) => {
            if (err) {
              reject(err);
            } else {
              resolve();
            }
          });
        } catch (error) {
          db.close();
          reject(error);
        }
      })();
    });
  });
}

// Run if executed directly
if (require.main === module) {
  generateDocumentation()
    .then(() => {
      process.exit(0);
    })
    .catch((error) => {
      console.error("Error generating schema documentation:", error);
      process.exit(1);
    });
}

module.exports = { generateDocumentation };

