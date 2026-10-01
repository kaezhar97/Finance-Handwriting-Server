export class RecognitionError
    extends Error
{
    constructor(
        status,
        code,
        message
    ) {
        super(message);

        this.status =
            status;

        this.code =
            code;
    }
}

const fail =
    message => {
        throw new RecognitionError(
            400,
            "invalid_request",
            message
        );
    };

export function validateImage(
    value,
    maximum
) {
    if (
        typeof value !== "string"
        ||
        !value.length
        ||
        value.length > maximum
        ||
        value.length % 4
        ||
        !/^[A-Za-z0-9+/]*={0,2}$/
            .test(value)
    ) {
        fail(
            "Missing or invalid PNG image."
        );
    }

    const bytes =
        Buffer.from(
            value,
            "base64"
        );

    if (
        bytes.length < 45
        ||
        bytes.toString("base64")
            !== value
        ||
        bytes
            .subarray(0, 8)
            .toString("hex")
            !==
            "89504e470d0a1a0a"
        ||
        bytes.toString(
            "ascii",
            12,
            16
        ) !== "IHDR"
        ||
        bytes.toString(
            "ascii",
            bytes.length - 8,
            bytes.length - 4
        ) !== "IEND"
    ) {
        fail(
            "Image must be a complete PNG."
        );
    }

    const width =
        bytes.readUInt32BE(16);

    const height =
        bytes.readUInt32BE(20);

    if (
        !width
        ||
        !height
        ||
        width > 4096
        ||
        height > 4096
        ||
        width * height
            > 12_000_000
    ) {
        fail(
            "Image dimensions are too large."
        );
    }

    return value;
}

export function validateProfile(
    profile
) {
    if (
        profile == null
        ||
        profile === ""
    ) {
        return null;
    }

    /*
     Legacy string notes remain supported,
     but are explicitly untrusted context.
     */
    if (
        typeof profile === "string"
    ) {
        if (
            profile.length > 4000
        ) {
            fail(
                "Writer profile is too long."
            );
        }

        return profile;
    }

    if (
        typeof profile !== "object"
        ||
        Array.isArray(profile)
        ||
        profile.version !== 1
        ||
        !Array.isArray(
            profile.corrections
        )
        ||
        profile.corrections.length
            > 20
    ) {
        fail(
            "Invalid writer profile."
        );
    }

    const corrections =
        profile.corrections.map(
            pair => {
                if (
                    !pair
                    ||
                    ![
                        "amount",
                        "label"
                    ].includes(
                        pair.kind
                    )
                    ||
                    typeof pair.recognized
                        !== "string"
                    ||
                    typeof pair.corrected
                        !== "string"
                    ||
                    pair.recognized.length
                        > 64
                    ||
                    pair.corrected.length
                        > 64
                ) {
                    fail(
                        "Invalid correction example."
                    );
                }

                return {
                    kind:
                        pair.kind,
                    recognized:
                        pair.recognized,
                    corrected:
                        pair.corrected
                };
            }
        );

    return {
        version: 1,
        corrections
    };
}

export function validateRequest(
    input
) {
    if (
        typeof input === "string"
    ) {
        if (
            Buffer.byteLength(
                input
            ) > 4_000_000
        ) {
            throw new RecognitionError(
                413,
                "payload_too_large",
                "Page request is too large."
            );
        }

        try {
            input =
                JSON.parse(input);
        } catch {
            fail(
                "Invalid JSON."
            );
        }
    }

    if (
        !input
        ||
        typeof input !== "object"
        ||
        Array.isArray(input)
    ) {
        fail(
            "Missing request body."
        );
    }

    if (
        Buffer.byteLength(
            JSON.stringify(input)
        ) > 4_000_000
    ) {
        throw new RecognitionError(
            413,
            "payload_too_large",
            "Page request is too large."
        );
    }

    if (
        input.schemaVersion
            != null
        &&
        input.schemaVersion
            !== "whole-page-request-v2"
    ) {
        fail(
            "Unsupported request version."
        );
    }

    return {
        imageBase64:
            validateImage(
                input.imageBase64,
                3_000_000
            ),

        handwritingReferenceBase64:
            input
                .handwritingReferenceBase64
                == null
                ? null
                : validateImage(
                    input
                        .handwritingReferenceBase64,
                    2_000_000
                ),

        writerProfile:
            validateProfile(
                input.writerProfile
            )
    };
}

export function validateAmount(
    value
) {
    if (
        typeof value !== "string"
        ||
        value.length > 32
        ||
        !/^-?\d+(?:\.\d{1,2})?$/
            .test(value)
    ) {
        return false;
    }

    const [
        whole,
        fraction = ""
    ] =
        value
            .replace(/^-/, "")
            .split(".");

    return (
        BigInt(whole) * 100n
        +
        BigInt(
            fraction.padEnd(
                2,
                "0"
            )
        )
    )
    <=
    99999999999999n;
}

export function canonicalAmount(
    value
) {
    const [
        whole,
        fraction = ""
    ] =
        value
            .replace(/^-/, "")
            .split(".");

    const cents =
        BigInt(whole)
        * 100n
        +
        BigInt(
            fraction.padEnd(
                2,
                "0"
            )
        );

    return (
        value.startsWith("-")
        &&
        cents !== 0n
            ? "-"
            : ""
    )
    +
    cents.toString();
}

function validRegion(region, allowEmpty = false) {
    if (!region || typeof region !== "object" || Array.isArray(region)) return false;
    const {x, y, width, height} = region;
    if ([x, y, width, height].some(value => typeof value !== "number" || !Number.isFinite(value))) return false;
    if (x < 0 || y < 0 || width < 0 || height < 0 || x + width > 1000 || y + height > 1000) return false;
    // Only an absent page title may use an empty rectangle. Amounts always need ink bounds.
    return (width > 0 && height > 0) || (allowEmpty && width === 0 && height === 0);
}

export function validateDocument(document) {
    const invalid = () => { throw new RecognitionError(502, "invalid_document", "Recognition returned an invalid document."); };
    const text = value => typeof value === "string" && value.length <= 200;
    const exactKeys = (value, keys) => value && typeof value === "object" && !Array.isArray(value) && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
    if (!exactKeys(document, ["title", "titleRegion", "categories"]) || !text(document.title) ||
        !validRegion(document.titleRegion, document.title.trim().length === 0) ||
        !Array.isArray(document.categories) || document.categories.length > 30) invalid();
    let count = 0;
    for (const category of document.categories) {
        if (!exactKeys(category, ["name", "fields"]) || !text(category.name) || !Array.isArray(category.fields)) invalid();
        for (const field of category.fields) {
            count += 1;
            if (count > 200 || !exactKeys(field, ["label", "amount", "amountRegion"]) || !text(field.label) ||
                !validateAmount(field.amount) || !validRegion(field.amountRegion)) invalid();
        }
    }
    return document;
}

export function decodeModelResponse(
    response
) {
    if (
        !response
        ||
        response.status
            !== "completed"
        ||
        response.output?.some(
            output =>
                output.content?.some(
                    content =>
                        content.type
                            === "refusal"
                )
        )
    ) {
        throw new RecognitionError(
            502,
            "incomplete_response",
            "Recognition was incomplete or refused. Please retry or enter manually."
        );
    }

    if (
        typeof response.output_text
            !== "string"
        ||
        Buffer.byteLength(
            response.output_text
        ) > 250_000
    ) {
        throw new RecognitionError(
            502,
            "invalid_document",
            "Recognition response is invalid."
        );
    }

    let document;

    try {
        document =
            JSON.parse(
                response.output_text
            );
    } catch {
        throw new RecognitionError(
            502,
            "invalid_document",
            "Recognition response is invalid JSON."
        );
    }

    return validateDocument(
        document
    );
}

export function createRateLimiter({
    now = Date.now,
    maximum = 20,
    window = 60_000
} = {}) {
    const entries =
        new Map();

    return key => {
        const time =
            now();

        for (
            const [
                ip,
                value
            ] of entries
        ) {
            if (
                time - value.started
                    >= window
            ) {
                entries.delete(ip);
            }
        }

        const value =
            entries.get(key);

        if (!value) {
            if (
                entries.size
                    >= 10_000
            ) {
                return true;
            }

            entries.set(
                key,
                {
                    started: time,
                    count: 1
                }
            );

            return false;
        }

        value.count += 1;

        return (
            value.count
            > maximum
        );
    };
}
