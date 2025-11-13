#!/usr/bin/env node
/**
 * Script to run the template usage tracking migration
 * Uses the API's /migrate endpoint to execute the SQL
 */

const https = require("https");

const REGION = process.env.REGION || "us-east-1";
const ENV = process.env.ENV || "dev";
const API_URL =
  process.env.API_URL ||
  `https://rtyj35z0ga.execute-api.${REGION}.amazonaws.com/prod`;

const SQL = `
BEGIN;

ALTER TABLE templates
ADD COLUMN IF NOT EXISTS last_used_at TIMESTAMP;

COMMENT ON COLUMN templates.last_used_at IS 'Timestamp when template was last used for draft generation';

COMMIT;
`;

async function runMigration() {
  console.log("🔄 Running template usage tracking migration");
  console.log("===========================================");
  console.log(`Environment: ${ENV}`);
  console.log(`Region: ${REGION}`);
  console.log("");

  console.log("🌐 Getting API URL...");
  const apiUrl = `${API_URL}/migrate`;
  console.log(`✅ API URL: ${API_URL}`);
  console.log("");

  const postData = JSON.stringify({ sql: SQL });

  const options = {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Content-Length": Buffer.byteLength(postData),
    },
  };

  return new Promise((resolve, reject) => {
    console.log("📝 Executing migration via API...");
    const req = https.request(apiUrl, options, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        const responseBody = JSON.parse(data);
        if (res.statusCode >= 200 && res.statusCode < 300) {
          console.log("✅ Migration executed successfully");
          console.log(`   ${responseBody.message || "Migration completed"}`);
          resolve(responseBody);
        } else {
          console.error("❌ Migration failed");
          console.error(`   Status: ${res.statusCode}`);
          console.error(`   Error: ${responseBody.error || "Unknown error"}`);
          console.error(`   Message: ${responseBody.message || "No message"}`);
          reject(
            new Error(
              `API request failed with status ${res.statusCode}: ${
                responseBody.message || responseBody.error
              }`
            )
          );
        }
      });
    });

    req.on("error", (error) => {
      console.error("❌ API request error:", error);
      reject(error);
    });

    req.write(postData);
    req.end();
  });
}

runMigration().catch((error) => {
  console.error("Script failed:", error);
  process.exit(1);
});
