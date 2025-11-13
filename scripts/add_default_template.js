#!/usr/bin/env node
/**
 * Script to add the default template to the database
 * Uses the API's migrate endpoint to execute the SQL
 */

const https = require("https");
const { execSync } = require("child_process");

const REGION = process.env.REGION || "us-east-1";
const ENV = process.env.ENV || "dev";

const DEFAULT_TEMPLATE_SQL = `
INSERT INTO templates (id, title, content, is_global, owner_id, created_at, updated_at)
SELECT 
  '00000000-0000-0000-0000-000000000001'::uuid,
  'Default',
  '{client_name}
{client_address}

{date}

{employer_name}
{employer_address}

Re: {subject}

Dear {employer_name}:

I am writing to demand payment of ${"{amount}"} and to inform you that I intend to resolve this matter out of court. However, if we cannot reach an agreement, I will file a lawsuit.

Statement of Case (Intended for Court Submission):

I was employed by {employer_name} from {employment_start} until my termination on {employment_end}. I am owed ${"{amount}"} for my last paycheck period from {wage_period_start} to {wage_period_end}. This amount represents my {pay_period_type} salary.

According to California Labor Code, I should have received my wages in full on the day of my termination. Additionally, Labor Code §203 grants me the right to recover one day of wages for each day my final paycheck remains unpaid.

I am willing to resolve this matter amicably and am open to discussing mediation. Please contact me at {email} to discuss this matter further.

Please send my paycheck, payable to {client_name}, to the address listed at the top of this letter.

If I do not receive a response by {deadline_date}, I will file a lawsuit. In that lawsuit, I will seek additional damages, legal services costs, court costs, and accrued interest.

Sincerely,

{client_name}',
  true,
  NULL,
  NOW(),
  NOW()
WHERE NOT EXISTS (
  SELECT 1 FROM templates WHERE id = '00000000-0000-0000-0000-000000000001'::uuid
);
`.trim();

async function getApiUrl() {
  try {
    const apiId = execSync(
      `aws apigatewayv2 get-apis --region ${REGION} --query "Items[?Name=='stenoai-${ENV}-api'].ApiId" --output text`,
      { encoding: "utf-8" }
    ).trim();

    if (!apiId || apiId === "None") {
      throw new Error("API not found");
    }

    const apiEndpoint = execSync(
      `aws apigatewayv2 get-api --api-id ${apiId} --region ${REGION} --query 'ApiEndpoint' --output text`,
      { encoding: "utf-8" }
    ).trim();

    return `${apiEndpoint}/prod`;
  } catch (error) {
    throw new Error(`Failed to get API URL: ${error.message}`);
  }
}

function makeRequest(url, data) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const postData = JSON.stringify(data);

    const options = {
      hostname: urlObj.hostname,
      port: urlObj.port || 443,
      path: urlObj.pathname,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(postData),
      },
    };

    const req = https.request(options, (res) => {
      let body = "";
      res.on("data", (chunk) => {
        body += chunk;
      });
      res.on("end", () => {
        try {
          const parsed = JSON.parse(body);
          resolve({ statusCode: res.statusCode, body: parsed });
        } catch (e) {
          resolve({ statusCode: res.statusCode, body: body });
        }
      });
    });

    req.on("error", (error) => {
      reject(error);
    });

    req.write(postData);
    req.end();
  });
}

async function addDefaultTemplate() {
  try {
    console.log("🔄 Adding default template to database");
    console.log("===========================================");
    console.log(`Environment: ${ENV}`);
    console.log(`Region: ${REGION}`);
    console.log("");

    // Get API URL
    console.log("🌐 Getting API URL...");
    const apiUrl = await getApiUrl();
    console.log(`✅ API URL: ${apiUrl}`);
    console.log("");

    // Execute migration via API
    console.log("📝 Executing migration via API...");
    const response = await makeRequest(`${apiUrl}/migrate`, {
      sql: DEFAULT_TEMPLATE_SQL,
    });

    if (response.statusCode === 200) {
      console.log("✅ Default template added successfully");
      console.log(
        `   ${response.body.message || "Migration executed successfully"}`
      );
    } else {
      console.error("❌ Failed to add default template");
      console.error(`   HTTP Status: ${response.statusCode}`);
      console.error(`   Error: ${JSON.stringify(response.body, null, 2)}`);
      process.exit(1);
    }

    console.log("");
    console.log("✅ Script complete");
  } catch (error) {
    console.error("❌ Error:", error.message);
    if (error.stack) {
      console.error(error.stack);
    }
    process.exit(1);
  }
}

// Run the script
addDefaultTemplate();
