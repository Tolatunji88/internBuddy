// node:sqlite prints an ExperimentalWarning when it loads on Node 22. It's noise for users,
// and in the MCP server it's noise on stderr. Filter exactly that warning and nothing else.
// Import this first in every entry point, before anything that opens the database.
const original = process.emitWarning.bind(process) as (...args: unknown[]) => void;

process.emitWarning = ((warning: string | Error, ...rest: unknown[]) => {
  const message = typeof warning === 'string' ? warning : (warning?.message ?? '');
  if (message.includes('SQLite is an experimental feature')) return;
  original(warning, ...rest);
}) as typeof process.emitWarning;

export {};
