import pino from 'pino';
import type { LogConfig } from '../config/types.js';

let _logger: pino.Logger | null = null;

export function createLogger(config: LogConfig): pino.Logger {
  const streams: pino.StreamEntry[] = [];

  if (config.format === 'pretty') {
    streams.push({
      stream: pino.transport({
        target: 'pino-pretty',
        options: { colorize: true, translateTime: 'SYS:HH:MM:ss', ignore: 'pid,hostname' },
      }),
    });
  } else {
    streams.push({ stream: process.stdout });
  }

  if (config.file) {
    streams.push({ stream: pino.destination({ dest: config.file, append: true, sync: false }) });
  }

  _logger =
    streams.length > 1
      ? pino({ level: config.level }, pino.multistream(streams))
      : pino({ level: config.level }, streams[0]!.stream);

  return _logger;
}

export function getLogger(): pino.Logger {
  if (!_logger) {
    _logger = pino({ level: 'info' });
  }
  return _logger;
}
