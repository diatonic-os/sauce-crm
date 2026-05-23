import {
  LogEvent,
  LogLevel,
  LOG_LEVEL_NAMES,
  Logger,
  TelemetryEvent,
  TelemetrySettings,
  parseLogLevel,
} from "./types";
import { TelemetrySink } from "./TelemetrySink";

interface LoggerHostSettings {
  telemetry?: TelemetrySettings;
}

function isoNow(): number {
  return Date.now();
}

function makeEvent(
  source: string,
  level: LogLevel,
  message: string,
  data?: Record<string, unknown>,
): LogEvent {
  return {
    level,
    levelName: LOG_LEVEL_NAMES[level],
    source,
    message,
    timestamp: isoNow(),
    data,
  };
}

class SauceLogger implements Logger {
  constructor(
    private readonly source: string,
    private readonly sink: TelemetrySink,
    private readonly settings: LoggerHostSettings,
  ) {}

  private minLevel(): LogLevel {
    return parseLogLevel(this.settings.telemetry?.level, LogLevel.INFO);
  }

  private dispatch(
    level: LogLevel,
    message: string,
    data?: Record<string, unknown>,
  ): void {
    if (level < this.minLevel()) return;
    this.sink.emit(makeEvent(this.source, level, message, data));
  }

  trace(message: string, data?: Record<string, unknown>): void {
    this.dispatch(LogLevel.TRACE, message, data);
  }
  debug(message: string, data?: Record<string, unknown>): void {
    this.dispatch(LogLevel.DEBUG, message, data);
  }
  info(message: string, data?: Record<string, unknown>): void {
    this.dispatch(LogLevel.INFO, message, data);
  }
  warn(message: string, data?: Record<string, unknown>): void {
    this.dispatch(LogLevel.WARN, message, data);
  }
  error(message: string, data?: Record<string, unknown>): void {
    this.dispatch(LogLevel.ERROR, message, data);
  }

  event(name: string, data?: Record<string, unknown>): void {
    const ev: TelemetryEvent = {
      kind: "telemetry",
      source: this.source,
      event: name,
      timestamp: isoNow(),
      data,
    };
    this.sink.emit(ev);
  }

  child(suffix: string): Logger {
    return new SauceLogger(
      `${this.source}.${suffix}`,
      this.sink,
      this.settings,
    );
  }
}

export function createLogger(
  source: string,
  sink: TelemetrySink,
  settings: LoggerHostSettings,
): Logger {
  return new SauceLogger(source, sink, settings);
}

export { LogLevel };
