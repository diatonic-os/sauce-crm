export enum LogLevel {
  TRACE = 0,
  DEBUG = 1,
  INFO = 2,
  WARN = 3,
  ERROR = 4,
}

export const LOG_LEVEL_NAMES = ["trace", "debug", "info", "warn", "error"] as const;
export type LogLevelName = (typeof LOG_LEVEL_NAMES)[number];

export function parseLogLevel(name: string | undefined, fallback: LogLevel = LogLevel.INFO): LogLevel {
  switch ((name ?? "").toLowerCase()) {
    case "trace": return LogLevel.TRACE;
    case "debug": return LogLevel.DEBUG;
    case "info":  return LogLevel.INFO;
    case "warn":  return LogLevel.WARN;
    case "error": return LogLevel.ERROR;
    default:      return fallback;
  }
}

export interface LogEvent {
  level: LogLevel;
  levelName: LogLevelName;
  source: string;
  message: string;
  timestamp: number;
  data?: Record<string, unknown>;
}

export interface TelemetryEvent {
  kind: "telemetry";
  source: string;
  event: string;
  timestamp: number;
  data?: Record<string, unknown>;
}

export interface TelemetrySettings {
  level?: LogLevelName;
  sinkPath?: string;
}

export interface Logger {
  trace(message: string, data?: Record<string, unknown>): void;
  debug(message: string, data?: Record<string, unknown>): void;
  info(message: string, data?: Record<string, unknown>): void;
  warn(message: string, data?: Record<string, unknown>): void;
  error(message: string, data?: Record<string, unknown>): void;
  event(name: string, data?: Record<string, unknown>): void;
  child(suffix: string): Logger;
}

export interface SinkAdapter {
  append(line: string): Promise<void>;
  exists(path: string): Promise<boolean>;
  mkdir(path: string): Promise<void>;
}
