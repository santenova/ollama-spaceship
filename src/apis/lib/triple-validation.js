/**
 * Triple Validation Benchmark
 *
 * Benchmarks available Ollama models on a personal-knowledge-graph triple
 * validation task. Test cases (utterance + candidate triple + expected
 * validity) are loaded from the `TestCase` ES entity (index
 * `sample-prompt-test-case` by default). Each model is asked to answer
 * True/False using TRIPLE_VALIDATION_PROMPT, then scored per model:
 *   correct / wrong / false positives / false negatives — matching the
 * Python benchmark loop (valid cases → FN on miss, invalid cases → FP on miss).
 *
 * TestCase storage convention:
 *   input           → utterance the user spoke
 *   expected_output → candidate triple, e.g. "(user, schema:favoriteColor, green)"
 *   notes           → "valid" | "invalid"  (expected model answer)
 */
import { chatCompletion } from './openai-fetch';
import { getEsConfig } from './es-entities';
import { telemetry } from './telemetry';
import { TelemetryEvents } from './telemetry-events';
export const TRIPLE_VALIDATION_PROMPT = `You are a triple validator for a personal knowledge graph.

Given an utterance that a user spoke to a voice assistant and a candidate triple, your task is to validate the triple

Utterances about the user usually have the form of "I am ...." or "My ..."

Utterances about the assistant usually have the form of "You are ...." or "Your ..."

Knowledge about the broader world should be discarded, you are only interested in personal information about the user or the voice assistant

Each triple is in the format:
(subject, predicate, object)

Only return 'True' if:
- The subject is 'self' (the assistant) or 'user' (the user)
- The triple is about user or assistant personal information
- The triple is factually plausible and makes sense
- The triple DOES NOT contradict the utterance

Otherwise, return 'False'.

Examples of valid triples:
"my favorite color is green" - ("user", "schema:favoriteColor", "green")
"your favorite color is blue" - ("self", "schema:favoriteColor", "blue")

Examples of invalid triples:
"my favorite color is green" - ("user", "schema:favoriteColor", "red")
"I love the color green" - ("self", "schema:favoriteColor", "green")
"your favorite color is blue" - ("user", "schema:favoriteColor", "blue")

YOU MUST answer with only one word: True or False.

The user said: "{utterance}"

Candidate triple: {triple}
`;
// In-memory cache: the last benchmark report is reused until the model set
// (or test-case count / options) changes, so repeated calls skip the
// expensive per-model benchmark.
let _cache = null;
/** Invalidate the cached benchmark report (forces a fresh run next call). */
export function clearTripleValidationCache() {
    _cache = null;
}
function cacheKey(models, caseCount, opts) {
    return JSON.stringify({
        m: [...models].sort(),
        tc: caseCount,
        idx: opts.testCaseIndex || '',
        pc: !!opts.includePerCase,
    });
}
/** Resolve the ES index holding TestCase records (config map → convention). */
function resolveTestCaseIndex(override) {
    if (override)
        return override;
    const cfg = getEsConfig();
    return cfg.indices?.TestCase || 'sample-prompt-test-case';
}
/** List every model available on the endpoint via /v1/models. */
async function listAvailableModels(ollamaEndpoints, defaultModel) {
    try {
        const ep = (ollamaEndpoints.find((e) => !!e) || 'http://127.0.0.1:11434').replace(/\/$/, '');
        const res = await fetch(`${ep}/v1/models`);
        if (!res.ok)
            return defaultModel ? [defaultModel] : [];
        const data = await res.json();
        const ids = (data.data || []).map((m) => m.id).filter(Boolean);
        return ids.length ? ids : (defaultModel ? [defaultModel] : []);
    }
    catch {
        return defaultModel ? [defaultModel] : [];
    }
}
/** Load + normalise test cases from the TestCase ES index. */
async function loadTestCases(index) {
    const cfg = getEsConfig();
    try {
        const res = await fetch(`${cfg.endpoint}/${index}/_search`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ query: { match_all: {} }, size: 500 }),
        });
        if (!res.ok)
            return [];
        const data = await res.json();
        return (data.hits?.hits || [])
            .map((h) => {
            const src = h._source || {};
            const utterance = String(src.input || '').trim();
            const triple = String(src.expected_output || '').trim();
            const notes = String(src.notes || '').toLowerCase();
            const expectedValid = notes.includes('invalid') ? false : true;
            return { id: h._id, utterance, triple, expectedValid };
        })
            .filter((t) => t.utterance && t.triple);
    }
    catch {
        return [];
    }
}
function buildPrompt(utterance, triple) {
    return TRIPLE_VALIDATION_PROMPT
        .replace(/\{utterance\}/g, utterance)
        .replace(/\{triple\}/g, triple);
}
/** Parse a one-word True/False verdict, tolerant of punctuation / extra text. */
function parseVerdict(raw) {
    const t = String(raw || '').trim().toLowerCase();
    if (!t)
        return null;
    if (/^(true|yes|valid)\b/.test(t))
        return true;
    if (/^(false|no|invalid)\b/.test(t))
        return false;
    if (t.includes('true'))
        return true;
    if (t.includes('false'))
        return false;
    return null;
}
async function validateOne(ollamaEndpoints, model, tc, signal) {
    try {
        const prompt = buildPrompt(tc.utterance, tc.triple);
        const raw = await chatCompletion(ollamaEndpoints, model, [{ role: 'user', content: prompt }], { temperature: 0, signal });
        const text = typeof raw === 'string' ? raw : JSON.stringify(raw);
        return { predicted: parseVerdict(text), raw: text };
    }
    catch (err) {
        return { predicted: null, raw: err?.message ?? String(err) };
    }
}
/**
 * Benchmark available models on the triple-validation task.
 *
 * @param ollamaEndpoints  Active Ollama endpoints.
 * @param defaultModel     Fallback model when /v1/models is unreachable.
 * @param opts.models      Restrict to a specific model list (default: all from /v1/models).
 * @param opts.testCaseIndex  Override the ES index holding test cases.
 * @param opts.includePerCase  Attach per-case predictions to each model score.
 */
export async function tripleValidation(ollamaEndpoints, defaultModel, opts = {}) {
    const cases = await loadTestCases(resolveTestCaseIndex(opts.testCaseIndex));
    const valid = cases.filter((c) => c.expectedValid);
    const invalid = cases.filter((c) => !c.expectedValid);
    const models = opts.models?.length
        ? opts.models
        : await listAvailableModels(ollamaEndpoints, defaultModel);
    // Serve the cached report when the model set (and options) are unchanged.
    const key = cacheKey(models, cases.length, opts);
    if (_cache && _cache.key === key)
        return _cache.report;
    telemetry.emit(TelemetryEvents.TRIPLE_VALIDATION_START, {
        modelCount: models.length,
        caseCount: cases.length,
        validCount: valid.length,
        invalidCount: invalid.length,
    });
    const scores = [];
    for (const model of models) {
        let correct = 0;
        let wrong = 0;
        let fp = 0;
        let fn = 0;
        let errors = 0;
        const perCase = [];
        // Valid cases: a correct model answers True. A False answer is a false negative.
        for (const tc of valid) {
            const { predicted, raw } = await validateOne(ollamaEndpoints, model, tc, opts.signal);
            if (opts.includePerCase)
                perCase.push({ utterance: tc.utterance, triple: tc.triple, expected: true, predicted, raw });
            if (predicted === null)
                errors++;
            else if (predicted === true)
                correct++;
            else {
                wrong++;
                fn++;
            }
        }
        // Invalid cases: a correct model answers False. A True answer is a false positive.
        for (const tc of invalid) {
            const { predicted, raw } = await validateOne(ollamaEndpoints, model, tc, opts.signal);
            if (opts.includePerCase)
                perCase.push({ utterance: tc.utterance, triple: tc.triple, expected: false, predicted, raw });
            if (predicted === null)
                errors++;
            else if (predicted === false)
                correct++;
            else {
                wrong++;
                fp++;
            }
        }
        const total = valid.length + invalid.length;
        scores.push({
            model,
            correct,
            wrong,
            falsePositives: fp,
            falseNegatives: fn,
            errors,
            total,
            accuracy: total ? correct / total : 0,
            ...(opts.includePerCase ? { perCase } : {}),
        });
    }
    const report = {
        models: scores,
        testCaseCount: cases.length,
        validCount: valid.length,
        invalidCount: invalid.length,
        created_date: new Date().toISOString(),
    };
    _cache = { key, report };
    telemetry.emit(TelemetryEvents.TRIPLE_VALIDATION_COMPLETE, {
        modelCount: models.length,
        bestModel: scores.sort((a, b) => b.accuracy - a.accuracy)[0]?.model ?? null,
    });
    return report;
}
