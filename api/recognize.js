import OpenAI from "openai";

const client = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY
});

export default async function handler(req, res) {
    if (req.method === "GET") {
        return res.status(200).json({
            ok: true,
            model: "gpt-5.6"
        });
    }

    if (req.method !== "POST") {
        return res.status(405).json({
            error: "Method not allowed."
        });
    }

    const imageBase64 =
        req.body?.imageBase64;

    if (
        typeof imageBase64 !== "string" ||
        imageBase64.length === 0
    ) {
        return res.status(400).json({
            error: "Missing handwriting image."
        });
    }

    if (imageBase64.length > 4_000_000) {
        return res.status(413).json({
            error: "Handwriting image is too large."
        });
    }

    try {
        const response =
            await client.responses.create({
                model: "gpt-5.6",

                store: false,

                input: [
                    {
                        role: "user",
                        content: [
                            {
                                type: "input_text",
                                text:
`Read the single handwritten financial amount in this image.

The image contains handwriting from exactly one financial amount field.

Rules:
- Transcribe every visible digit from left to right.
- Pay special attention to the FINAL digit. Do not truncate it.
- Do not perform arithmetic.
- Ignore background lines.
- Ignore decorative marks that are clearly not part of the number.
- Remove thousands separators in your returned text.
- Do not return a dollar sign.
- A leading minus sign is allowed.
- A decimal point and up to two decimal digits are allowed.
- Do not guess a missing or ambiguous digit.

Examples:
handwritten 2 1 8 2 -> 2182
handwritten 9 1 3 0 -> 9130
handwritten 1,234.56 -> 1234.56

If the complete value is not confidently readable, set readable to false.`
                            },
                            {
                                type: "input_image",
                                image_url:
                                    `data:image/png;base64,${imageBase64}`,
                                detail: "high"
                            }
                        ]
                    }
                ],

                text: {
                    format: {
                        type: "json_schema",
                        name:
                            "handwritten_financial_amount",
                        strict: true,
                        schema: {
                            type: "object",
                            properties: {
                                readable: {
                                    type: "boolean"
                                },
                                text: {
                                    type: "string"
                                }
                            },
                            required: [
                                "readable",
                                "text"
                            ],
                            additionalProperties:
                                false
                        }
                    }
                },

                max_output_tokens: 100
            });

        let result;

        try {
            result =
                JSON.parse(
                    response.output_text
                );
        } catch {
            return res.status(502).json({
                error:
                    "The AI returned an invalid recognition result."
            });
        }

        if (
            result.readable !== true ||
            typeof result.text !== "string"
        ) {
            return res.status(422).json({
                error:
                    "The AI could not confidently read the complete handwritten amount."
            });
        }

        const text =
            result.text.trim();

        const validAmount =
            /^-?\d+(?:\.\d{1,2})?$/;

        if (!validAmount.test(text)) {
            return res.status(422).json({
                error:
                    "The AI response was not one valid USD amount."
            });
        }

        return res.status(200).json({
            text
        });
    } catch (error) {
        console.error(error);

        return res.status(500).json({
            error:
                "The AI handwriting-recognition service failed."
        });
    }
}
