// Main package entry point — exports public API
export { WorkerManager } from './workers/WorkerManager.js';
export { WorkerPool } from './workers/WorkerPool.js';
export { Worker } from './workers/Worker.js';
export { JobProcessor } from './workers/JobProcessor.js';
export { Scheduler } from './workers/Scheduler.js';
export { HealthMonitor } from './workers/HealthMonitor.js';
export type { WorkerStats, PoolStats, ProcessResult, WorkerManagerOptions } from './workers/types.js';


export { QueueManager } from './queue/QueueManager.js';
export { QueueWorker } from './queue/QueueWorker.js';
export { SqliteQueue } from './queue/SqliteQueue.js';
export { InMemoryQueue } from './queue/InMemoryQueue.js';
export { PriorityQueue } from './queue/PriorityQueue.js';
export type { IQueue } from './queue/IQueue.js';
export type { QueueJob, QueueStats, EnqueueOptions, DequeueOptions, JobStatus } from './queue/types.js';


export { StorageEngine } from './storage/StorageEngine.js';
export { JsonlWriter } from './storage/JsonlWriter.js';
export { CsvWriter } from './storage/CsvWriter.js';
export { CheckpointManager } from './storage/CheckpointManager.js';
export { FileManager } from './storage/FileManager.js';
export type { StorageConfig, StorageWriter, WriteResult, CheckpointData, OutputFormat } from './storage/types.js';

export { ExtractionEngine } from './extract/ExtractionEngine.js';
export { NextDataParser } from './extract/NextDataParser.js';
export { JsonLdParser } from './extract/JsonLdParser.js';
export { HtmlParser } from './extract/HtmlParser.js';
export type { PropertyRecord, ExtractionResult, AgentDetails } from './extract/types.js';


export { FetchEngine } from './fetch/FetchEngine.js';
export { HttpFetcher } from './fetch/HttpFetcher.js';
export { SessionManager } from './fetch/SessionManager.js';
export { ProxyManager } from './fetch/ProxyManager.js';
export { RateLimiter } from './fetch/RateLimiter.js';
export { HeaderBuilder } from './fetch/HeaderBuilder.js';
export { TlsProfiler } from './fetch/TlsProfiler.js';
export type { FetchRequest, FetchResponse, Session, TlsProfile, ProxyEntry } from './fetch/types.js';

export { Semaphore } from './concurrency/Semaphore.js';
export { CircuitBreaker } from './concurrency/CircuitBreaker.js';
export type { CircuitState, CircuitBreakerOptions } from './concurrency/CircuitBreaker.js';
export { RateLimiter as ConcurrencyRateLimiter } from './concurrency/RateLimiter.js';
export type { RateLimiterOptions as ConcurrencyRateLimiterOptions } from './concurrency/RateLimiter.js';
export { ConcurrencyController } from './concurrency/ConcurrencyController.js';
export type { ConcurrencyControllerOptions } from './concurrency/ConcurrencyController.js';

export { ScraperEngine } from './engine/ScraperEngine.js';
export { JobManager } from './engine/JobManager.js';
export { Pipeline } from './engine/Pipeline.js';
export type { PipelineFetcher, PipelineExtractor, PipelineStorage } from './engine/Pipeline.js';
export { LifecycleManager } from './engine/LifecycleManager.js';
export { EngineState } from './engine/EngineState.js';
export type { EngineConfig, EngineHooks, EngineStats, HealthStatus, PipelineResult, EngineStateValue } from './engine/types.js';

export { RetryManager } from './retry/RetryManager.js';
export type { RetryManagerCallbacks } from './retry/RetryManager.js';
export { RetryClassifier } from './retry/RetryClassifier.js';
export type { Classification as RetryClassification } from './retry/RetryClassifier.js';
export { BackoffStrategy } from './retry/BackoffStrategy.js';
export type { BackoffOptions } from './retry/BackoffStrategy.js';
export type { RetryVerdict, RetryAttempt, RetryOutcome, RetryManagerOptions } from './retry/types.js';

export { ConfigManager } from './config/ConfigManager.js';
export { DEFAULT_CONFIG } from './config/defaults.js';
export type { ScraperConfig, FetchConfig, RetryConfig } from './config/types.js';

export { ErrorHandler } from './errors/ErrorHandler.js';
export {
  ScraperError,
  FetchError,
  TimeoutError,
  RateLimitError,
  BotDetectedError,
  NotFoundError,
  GoneError,
  ParseError,
  ProxyError,
  StorageError,
} from './errors/error-types.js';

export { createLogger, getLogger } from './logger/Logger.js';
