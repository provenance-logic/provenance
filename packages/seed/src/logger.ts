type Level = 'debug' | 'info' | 'warn' | 'error';

const order: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

export interface Logger {
  debug(msg: string, ctx?: Record<string, unknown>): void;
  info(msg: string, ctx?: Record<string, unknown>): void;
  warn(msg: string, ctx?: Record<string, unknown>): void;
  error(msg: string, ctx?: Record<string, unknown>): void;
}

export function createLogger(level: Level): Logger {
  const threshold = order[level];
  const emit = (l: Level, msg: string, ctx?: Record<string, unknown>): void => {
    if (order[l] < threshold) return;
    const line = ctx && Object.keys(ctx).length > 0 ? `${msg} ${JSON.stringify(ctx)}` : msg;
    const prefix = `[${l.toUpperCase()}]`;
    if (l === 'error') console.error(prefix, line);
    else console.log(prefix, line);
  };
  return {
    debug: (m, c) => emit('debug', m, c),
    info: (m, c) => emit('info', m, c),
    warn: (m, c) => emit('warn', m, c),
    error: (m, c) => emit('error', m, c),
  };
}
