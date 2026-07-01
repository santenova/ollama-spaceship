/**
 * Configuration Schema Validation (#6)
 * Uses zod for strict schema enforcement — fails fast with clear messages.
 */
import { z } from 'zod';
export declare const ClientConfigSchema: z.ZodObject<{
    serverUrl: z.ZodString;
    appId: z.ZodString;
    functionsVersion: z.ZodOptional<z.ZodString>;
    headers: z.ZodDefault<z.ZodRecord<z.ZodString, z.ZodString>>;
    model: z.ZodString;
    ollamaEndpoints: z.ZodArray<z.ZodString, "many">;
    messages: z.ZodOptional<z.ZodArray<z.ZodObject<{
        role: z.ZodString;
        content: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        content?: string;
        role?: string;
    }, {
        content?: string;
        role?: string;
    }>, "many">>;
    rateLimit: z.ZodOptional<z.ZodNullable<z.ZodObject<{
        maxCalls: z.ZodOptional<z.ZodNumber>;
        windowMs: z.ZodOptional<z.ZodNumber>;
    }, "strip", z.ZodTypeAny, {
        maxCalls?: number;
        windowMs?: number;
    }, {
        maxCalls?: number;
        windowMs?: number;
    }>>>;
}, "strip", z.ZodTypeAny, {
    model?: string;
    headers?: Record<string, string>;
    serverUrl?: string;
    appId?: string;
    functionsVersion?: string;
    ollamaEndpoints?: string[];
    messages?: {
        content?: string;
        role?: string;
    }[];
    rateLimit?: {
        maxCalls?: number;
        windowMs?: number;
    };
}, {
    model?: string;
    headers?: Record<string, string>;
    serverUrl?: string;
    appId?: string;
    functionsVersion?: string;
    ollamaEndpoints?: string[];
    messages?: {
        content?: string;
        role?: string;
    }[];
    rateLimit?: {
        maxCalls?: number;
        windowMs?: number;
    };
}>;
export type ClientConfig = z.infer<typeof ClientConfigSchema>;
/**
 * Validate config and return { valid, errors }.
 * Safe to call in production — never throws.
 */
export declare function validateClientConfig(config: unknown): {
    valid: boolean;
    errors: string[];
};
/**
 * Parse and return a strongly-typed ClientConfig, or throw a ZodError.
 * Use this at app initialisation for a "fail-fast" guarantee.
 */
export declare function parseClientConfig(config: unknown): ClientConfig;
//# sourceMappingURL=config-schema.d.ts.map