// Explicitly opt-in: sends only the image the operator names. Never runs under npm test.
import {assertV3Integration} from "./assert-v3-integration.mjs";
import {readFile} from "node:fs/promises";
if (!process.argv[2]) { console.error("Usage: npm run test:integration -- /path/to/synthetic-page.png [endpoint]"); process.exit(2); }
const image = await readFile(process.argv[2]);
const response = await fetch(process.argv[3] || "https://financehandwritingserver.vercel.app/api/recognize", {
 method:"POST",headers:{"Content-Type":"application/json"},
 body:JSON.stringify({schemaVersion:"whole-page-request-v2",imageBase64:image.toString("base64")}), signal:AbortSignal.timeout(250_000)
});
const data = await response.json();
console.log(JSON.stringify({status:response.status,...data},null,2));
if (!response.ok) process.exitCode=1;
else console.log("V3 integration verified:", JSON.stringify(assertV3Integration(data)));
