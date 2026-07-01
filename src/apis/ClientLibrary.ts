import { client, config, invokeLLM } from './client';
import type { AugmentedChunk, StreamSummary } from './lib/progress-tracker';
import { estimateCost, finaliseEstimate, getPricingTable } from './lib/cost-estimator';
import type { CostEstimate } from './lib/cost-estimator';
import { saveMemory, recallMemory, buildMemoryContext, clearMemory } from './lib/conversation-memory';
import type { MemoryTurn, MemoryRecall } from './lib/conversation-memory';
import { splitTest, getABTestHistory } from './lib/ab-testing';
import type { ABVariant, ABTestResult } from './lib/ab-testing';
import { scheduleJob, runJob, runDueJobs, setJobStatus, cancelJob, listJobs } from './lib/scheduled-jobs';
import type { ScheduledJob, JobOutput } from './lib/scheduled-jobs';
import { groundCheck } from './lib/ground-check';
import type { GroundCheckResult } from './lib/ground-check';
import { withFailover, pingEndpoints, getEndpointHealth, resetEndpointHealth } from './lib/endpoint-failover';
import { tripleValidation } from './lib/triple-validation';
import type { TripleValidationReport } from './lib/triple-validation';
export { client };

type StreamTask = 'chat' | 'vision' | 'code' | 'audio' | 'thinking';
type TaskType = 'chat' | 'thinking' | 'json' | 'vision';

interface StreamObserver {
  next: (chunk: string | AugmentedChunk) => void;
  error: (err: Error) => void;
  complete: (summary?: StreamSummary) => void;
}

interface StreamSubscription {
  subscribe: (obs: StreamObserver) => void;
}

interface BeamResult {
  model: string;
  status: 'fulfilled' | 'rejected';
  response: string | null;
  error: string | null;
  durationMs: number;
}

interface BeamResponse {
  prompt: string;
  taskType: string;
  models: string[];
  results: BeamResult[];
}

/**
 * Unified class-based API for the full AI client library.
 *
 * Covers: InvokeLLM, streaming, vision, vector embeddings, vectorIndex,
 * beaming, expandQuery, solution/debate, websearch, toolbox, thinking,
 * config management, rate limiting, circuit breaker, telemetry, and entities.
 *
 * Usage:
 *   const lib = new ClientLibrary();
 *   const text = await lib.invoke("What is the speed of light?");
 *   const stream = lib.stream('chat', 'Tell me a joke');
 *   stream.subscribe({ next: console.log, error: console.error, complete: () => {} });
 */
export class ClientLibrary {
  /** Underlying low-level client — use for advanced/direct access */
  readonly raw = client;

  // ─────────────────────────────────────────────────
  // LLM Invocation
  // ─────────────────────────────────────────────────

  /**
   * Invoke the LLM with a prompt or messages array.
   * Returns parsed JSON when response_json_schema is provided, otherwise plain text.
   */
  invoke(params: Parameters<typeof client.integrations.Core.InvokeLLM>[0]): Promise<any> {
    return client.integrations.Core.InvokeLLM(params);
  }

  /**
   * Batched variant — groups parallel InvokeLLM calls within a 20ms window.
   * Use when firing many parallel calls to avoid overwhelming the host.
   */
  invokeBatched(params: any): Promise<string> {
    return client.integrations.Core.InvokeLLMBatched(params);
  }

  // ─────────────────────────────────────────────────
  // Streaming
  // ─────────────────────────────────────────────────

  /**
   * Stream a response token-by-token for the given task and input.
   * When trackProgress is true (default), chunks are AugmentedChunk objects with metadata.
   * Set trackProgress: false for plain string chunks.
   */
  stream(
    task: StreamTask,
    input: string,
    opts?: { trackProgress?: boolean; signal?: AbortSignal },
  ): StreamSubscription {
    return client.streamResponse(task, input, opts);
  }

  // ─────────────────────────────────────────────────
  // Vision
  // ─────────────────────────────────────────────────

  /**
   * Encode a File, Blob, base64 string, or data URL into a data URL for vision requests.
   */
  encodeImage(source: string | File | Blob): Promise<string> {
    return client.integrations.Core.vision.encode(source);
  }

  /**
   * Send a vision request. Returns structured JSON when schema is provided,
   * otherwise { content, raw }.
   */
  visionSend(
    endpoint: string,
    model: string,
    imageBase64: string,
    prompt: string,
    schema?: Record<string, any> | null,
    temperature?: number,
    signal?: AbortSignal,
  ): Promise<any> {
    return client.integrations.Core.vision.send(endpoint, model, imageBase64, prompt, schema, temperature, signal);
  }

  // ─────────────────────────────────────────────────
  // Vector / Embeddings
  // ─────────────────────────────────────────────────

  /**
   * Generate an embedding vector for the given text.
   * Returns number[] or null on failure.
   */
  vector(text: string, signal?: AbortSignal): Promise<number[] | null> {
    return client.integrations.Core.vector(text, signal);
  }

  /**
   * Full vector pipeline: message → keywords → ES reindex with embeddings.
   * Returns { targetIndex, vectorKey, ... }.
   */
  vectorIndex(params: {
    message: string;
    targetIndex?: string;
    dims?: number;
    arrayFields?: string[];
    signal?: AbortSignal;
  }): Promise<any> {
    return client.integrations.Core.vectorIndex(params);
  }

  // ─────────────────────────────────────────────────
  // Beaming
  // ─────────────────────────────────────────────────

  /**
   * Beam the same prompt to all available models in parallel (concurrency-capped).
   * Returns structured results per model with status, response, error, and durationMs.
   */
  beam(
    prompt: string,
    opts: { taskType?: TaskType; signal?: AbortSignal; concurrency?: number } = {},
  ): Promise<BeamResponse> {
    return client.integrations.Core.beaming(prompt, opts);
  }

  // ─────────────────────────────────────────────────
  // Query Expansion & Solution Debate
  // ─────────────────────────────────────────────────

  /**
   * Expand a query into 5-8 related terms using the LLM.
   * Always returns an array that includes the original query.
   */
  expandQuery(query: string, signal?: AbortSignal): Promise<string[]> {
    return client.integrations.Core.expandQuery(query, signal);
  }

  /**
   * Run a multi-turn persona debate to generate a solutions manifest.
   * Returns { manifest, personas, debate }.
   */
  solution(prompt: string, signal?: AbortSignal): Promise<{ manifest: string; personas: any[]; debate: string[] }> {
    return client.integrations.Core.solution(prompt, signal);
  }

  // ─────────────────────────────────────────────────
  // Web Search & Toolbox
  // ─────────────────────────────────────────────────

  /** Run a web search and return summarised results. */
  websearch(params: { prompt: string; [key: string]: any }): Promise<any> {
    return client.integrations.Core.websearch(params);
  }

  /** Run multi-tool execution (flight tracker, calculator, etc.). */
  toolbox(params: { prompt: string; [key: string]: any }): Promise<any> {
    return client.integrations.Core.toolbox(params);
  }

  // ─────────────────────────────────────────────────
  // Thinking
  // ─────────────────────────────────────────────────

  /** Stream a chain-of-thought thinking response. */
  thinking(prompt: string): ReturnType<typeof client.integrations.Core.thinking> {
    return client.integrations.Core.thinking(prompt);
  }

  /** Check whether the model supports thinking for this prompt. */
  thinkingEnabled(prompt: string, signal?: AbortSignal): Promise<any> {
    return client.integrations.Core.thinkingEnabled(prompt, signal);
  }

  /** Get thinking depth levels for this prompt. */
  thinkingLevels(prompt: string, signal?: AbortSignal): Promise<any> {
    return client.integrations.Core.thinkingLevels(prompt, signal);
  }

  // ─────────────────────────────────────────────────
  // Chat Session Messages
  // ─────────────────────────────────────────────────

  /** Retrieve the full messages array of a ChatSession by its ID. */
  getMessages(sessionId: string): Promise<any[]> {
    return client.getMessages(sessionId);
  }

  // ─────────────────────────────────────────────────
  // Config Management
  // ─────────────────────────────────────────────────

  /** Get the current resolved config. */
  getConfig() {
    return client.getConfig();
  }

  /** Live-update config (model, endpoints, headers, etc.) without recreating the client. */
  updateConfig(partial: Parameters<typeof client.updateConfig>[0]) {
    return client.updateConfig(partial);
  }

  /** Get the Elasticsearch config. */
  getEsConfig() {
    return client.getEsConfig();
  }

  /** Persist an updated Elasticsearch config. */
  saveEsConfig(cfg: any) {
    return client.saveEsConfig(cfg);
  }

  // ─────────────────────────────────────────────────
  // Rate Limiting
  // ─────────────────────────────────────────────────

  /** Set rate limit (null = unlimited). */
  setLimits(limits: { maxCalls?: number; windowMs?: number } | null) {
    return client.setLimits(limits);
  }

  /** Get current rate limit config (null = unlimited). */
  getLimits() {
    return client.getLimits();
  }

  // ─────────────────────────────────────────────────
  // Infrastructure Utilities
  // ─────────────────────────────────────────────────

  /** Circuit breaker — check, trip, and reset the primary Ollama API breaker. */
  get circuitBreaker() { return client.circuitBreaker; }

  /** Abort manager — create/cancel named AbortControllers. */
  get abortManager() { return client.abortManager; }

  /** Structured logger with timed(), info(), warn(), error(). */
  get logger() { return client.clientLogger; }

  /** Telemetry emitter — emit and subscribe to named events. */
  get telemetry() { return client.telemetry; }

  /** Tool registry — register and invoke named tools. */
  get toolRegistry() { return client.toolRegistry; }

  /** Model router — resolve optimal model per task type. */
  get modelRouter() { return client.modelRouter; }

  /** Prompt router — enhance prompts with persona context. */
  get promptRouter() { return client.promptRouter; }

  /** Auth middleware — inject auth headers into outgoing requests. */
  get authMiddleware() { return client.authMiddleware; }

  // ─────────────────────────────────────────────────
  // Entity Access
  // ─────────────────────────────────────────────────

  /**
   * ES-backed entity store. Usage: lib.entities.Persona.list(), .filter(), .get(), etc.
   */
  get entities(): Record<string, any> { return client.esEntities as Record<string, any>; }

  /** ES endpoint URL. */
  get esEndpoint() { return client.esEndpoint; }

  // ─────────────────────────────────────────────────
  // 1. Prompt Cost Estimator
  // ─────────────────────────────────────────────────

  /**
   * Estimate the USD cost of an LLM call before or after execution.
   * @param prompt       Input text (prompt + system message).
   * @param model        Model name (e.g. 'llama3:8b').
   * @param outputTokens Actual output tokens from a completed call (0 = pre-call estimate).
   */
  estimateCost(prompt: string, model: string, outputTokens = 0): CostEstimate {
    return estimateCost(prompt, model, outputTokens);
  }

  /** Attach actual output token count to an existing pre-call estimate. */
  finaliseEstimate(estimate: CostEstimate, actualOutputTokens: number): CostEstimate {
    return finaliseEstimate(estimate, actualOutputTokens);
  }

  /** Return the full model → pricing table for a cost dashboard. */
  getPricingTable() {
    return getPricingTable();
  }

  // ─────────────────────────────────────────────────
  // 2. Persistent Conversation Memory (RAG)
  // ─────────────────────────────────────────────────

  /**
   * Embed and persist a chat turn to cross-session memory.
   * Call after each user/assistant exchange to build up memory over time.
   */
  saveMemory(
    turn: Omit<MemoryTurn, 'vector' | 'created_date'>,
    embeddingModel = 'nomic-embed-text',
  ): Promise<void> {
    return saveMemory(turn, client.getConfig().ollamaEndpoints, embeddingModel);
  }

  /**
   * Retrieve the top-K most semantically relevant past memory turns for a user.
   */
  recallMemory(
    userEmail: string,
    queryText: string,
    topK = 5,
    embeddingModel = 'nomic-embed-text',
  ): Promise<MemoryRecall[]> {
    return recallMemory(userEmail, queryText, client.getConfig().ollamaEndpoints, embeddingModel, topK);
  }

  /**
   * Build a ready-to-inject system message string from recalled memories.
   * Returns null when no relevant memories exist.
   */
  buildMemoryContext(
    userEmail: string,
    queryText: string,
    topK = 5,
    embeddingModel = 'nomic-embed-text',
  ): Promise<string | null> {
    return buildMemoryContext(userEmail, queryText, client.getConfig().ollamaEndpoints, embeddingModel, topK);
  }

  /** Delete all memory turns for a user (privacy / account deletion). */
  clearMemory(userEmail: string): Promise<void> {
    return clearMemory(userEmail);
  }

  // ─────────────────────────────────────────────────
  // 3. Prompt A/B Testing
  // ─────────────────────────────────────────────────

  /**
   * Run a split test across multiple prompt variants.
   * Each variant is sent to the LLM, scored by an LLM judge, and results
   * are persisted to Elasticsearch. Returns the winner and full score breakdown.
   */
  splitTest(
    variants: ABVariant[],
    opts: { metrics?: string[]; signal?: AbortSignal; parallel?: boolean } = {},
  ): Promise<ABTestResult> {
    const cfg = client.getConfig();
    return splitTest(variants, opts, cfg.ollamaEndpoints, cfg.model);
  }

  /** Retrieve past A/B test results from ES. */
  getABTestHistory(limit = 20): Promise<ABTestResult[]> {
    return getABTestHistory(limit);
  }

  // ─────────────────────────────────────────────────
  // 4. Scheduled / Async LLM Jobs
  // ─────────────────────────────────────────────────

  /**
   * Create a scheduled LLM job that fires on a cron expression.
   * Output is written to the specified ES entity index on each run.
   */
  scheduleJob(
    jobDef: Omit<ScheduledJob, 'id' | 'status' | 'created_date' | 'updated_date' | 'nextRunAt' | 'runCount'>,
  ): Promise<ScheduledJob> {
    const cfg = client.getConfig();
    return scheduleJob(jobDef, cfg.ollamaEndpoints, cfg.model);
  }

  /** Immediately execute a single job regardless of its schedule. */
  runJob(job: ScheduledJob): Promise<JobOutput> {
    const cfg = client.getConfig();
    return runJob(job, cfg.ollamaEndpoints, cfg.model);
  }

  /**
   * Find all active jobs whose nextRunAt is in the past and execute them.
   * Wire this to a polling interval or a backend automation.
   */
  runDueJobs(): Promise<JobOutput[]> {
    const cfg = client.getConfig();
    return runDueJobs(cfg.ollamaEndpoints, cfg.model);
  }

  /** Pause or resume a scheduled job. */
  setJobStatus(jobId: string, status: 'active' | 'paused'): Promise<void> {
    return setJobStatus(jobId, status);
  }

  /** Permanently cancel and delete a scheduled job. */
  cancelJob(jobId: string): Promise<void> {
    return cancelJob(jobId);
  }

  /** List all scheduled jobs, optionally filtered by status. */
  listJobs(status?: ScheduledJob['status']): Promise<ScheduledJob[]> {
    return listJobs(status);
  }

  // ─────────────────────────────────────────────────
  // 7. Hallucination / Grounding Checker
  // ─────────────────────────────────────────────────

  /**
   * Check whether an LLM response is grounded in the provided source documents.
   * Fetches source docs from ES, embeds both response and sources, computes cosine
   * similarity, then uses an LLM judge to flag unsupported claims.
   *
   * @param response      LLM response text to verify.
   * @param sourceDocIds  Array of ES document IDs to use as ground-truth sources.
   * @param embeddingModel Embedding model (default: nomic-embed-text).
   */
  groundCheck(
    response: string,
    sourceDocIds: string[],
    embeddingModel = 'nomic-embed-text',
  ): Promise<GroundCheckResult> {
    const cfg = client.getConfig();
    return groundCheck(response, sourceDocIds, cfg.ollamaEndpoints, cfg.model, embeddingModel);
  }

  // ─────────────────────────────────────────────────
  // 8. Multi-Endpoint Failover
  // ─────────────────────────────────────────────────

  /**
   * Execute a function with automatic failover across all configured endpoints.
   * On failure, tries the next endpoint; unhealthy endpoints are skipped for 30s.
   *
   * @param fn  Function receiving a single endpoint string, returning a Promise.
   */
  withFailover<T>(fn: (endpoint: string) => Promise<T>): Promise<T> {
    return withFailover(client.getConfig().ollamaEndpoints, fn);
  }

  /** Ping all configured endpoints and return latency + health status. */
  pingEndpoints(): Promise<Array<{ endpoint: string; healthy: boolean; latencyMs: number }>> {
    return pingEndpoints(client.getConfig().ollamaEndpoints);
  }

  /** Return cached health state of all known endpoints. */
  getEndpointHealth() {
    return getEndpointHealth();
  }

  /** Reset cached endpoint health (e.g. after adding a new endpoint). */
  resetEndpointHealth(): void {
    resetEndpointHealth();
  }

  // ─────────────────────────────────────────────────
  // 10. Triple Validation Benchmark
  // ─────────────────────────────────────────────────

  /**
   * Benchmark available models on the triple-validation task.
   * Loads test cases (utterance + triple + expected validity) from the
   * `TestCase` ES index and scores each model: correct / wrong / FP / FN.
   *
   * @param opts.models         Restrict to a specific model list (default: all from /v1/models).
   * @param opts.testCaseIndex  Override the ES index holding test cases.
   * @param opts.includePerCase Attach per-case predictions to each model score.
   */
  tripleValidation(
    opts: { models?: string[]; testCaseIndex?: string; signal?: AbortSignal; includePerCase?: boolean } = {},
  ): Promise<TripleValidationReport> {
    const cfg = client.getConfig();
    return tripleValidation(cfg.ollamaEndpoints, cfg.model, opts);
  }
}

/** Singleton instance — import and use directly without instantiating. */
export const clientLibrary = new ClientLibrary();

console.log(clientLibrary);
