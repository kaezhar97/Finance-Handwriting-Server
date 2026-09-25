import OpenAI from "openai";
import { RecognitionError, validateRequest, createRateLimiter } from "../lib/contract.js";
import { recognizePage } from "../lib/recognition.js";
import { PROMPT_VERSION, SCHEMA_VERSION } from "../lib/prompt.js";
const MODEL = process.env.OPENAI_MODEL || "gpt-5.6";
const limited = createRateLimiter();
let client;
const getClient = () => client ??= new OpenAI({apiKey:process.env.OPENAI_API_KEY,maxRetries:0,timeout:210_000});
export function createHandler({clientProvider=getClient,model=MODEL,rateLimit=limited,timeoutMs=220_000}={}) {
    return async (req,res) => {
        res.setHeader("Cache-Control","no-store");
        if (req.method === "GET") return res.status(200).json({ok:true,model,mode:"whole-page-consensus",passes:3,promptVersion:PROMPT_VERSION,schemaVersion:SCHEMA_VERSION});
        if (req.method !== "POST") { res.setHeader("Allow","GET, POST"); return res.status(405).json({error:"Method not allowed."}); }
        const ip = String(req.headers?.["x-forwarded-for"] || req.socket?.remoteAddress || "unknown").split(",")[0].trim();
        if (rateLimit(ip)) { res.setHeader("Retry-After","60"); return res.status(429).json({error:"Too many recognition requests. Please wait and try again.",code:"rate_limited"}); }
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(),timeoutMs);
        const abort = () => controller.abort(); req.on?.("aborted",abort);
        try {
            const request = validateRequest(req.body);
            const result = await recognizePage({client:clientProvider(),model,request,signal:controller.signal});
            return res.status(200).json(result);
        } catch (error) {
            controller.abort();
            let status = error instanceof RecognitionError ? error.status : error.status === 429 ? 429 : 502;
            if (error.name === "AbortError" || error.name === "APIUserAbortError" || error.name === "APIConnectionTimeoutError") status = 504;
            const message = error instanceof RecognitionError ? error.message : status === 504 ? "Recognition timed out. Please retry." : status === 429 ? "Recognition is busy. Please retry later." : "Whole-page recognition failed. Please retry or enter manually.";
            // Never log images, candidate documents, financial values, profiles, API keys, or SDK error bodies.
            return res.status(status).json({error:message,code:error instanceof RecognitionError ? error.code : "recognition_failed"});
        } finally { clearTimeout(timer); req.off?.("aborted",abort); }
    };
}
export default createHandler();
