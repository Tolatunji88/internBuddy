/**
 * The one place that talks to the network. Every rule about being a polite client lives here:
 * an identifying User-Agent, a minimum gap between requests to the same host, a timeout,
 * bounded retries that honour Retry-After, and conditional requests so unchanged boards
 * cost a 304 instead of a full download.
 */
export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export const USER_AGENT =
  'internBuddy/0.1 (personal internship search; +https://github.com/Tolatunji88/internBuddy)';

export interface HttpOptions {
  fetchImpl?: FetchLike;
  timeoutMs?: number;
  /** Minimum gap between two requests to the same host. */
  minHostIntervalMs?: number;
  retries?: number;
  sleep?: (ms: number) => Promise<void>;
  userAgent?: string;
}

export interface GetOptions {
  as?: 'json' | 'text';
  etag?: string | null;
  lastModified?: string | null;
}

export interface GetResult {
  ok: boolean;
  status: number;
  notModified: boolean;
  body: unknown;
  etag: string | null;
  lastModified: string | null;
  error: string | null;
}

const realSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export class HttpClient {
  private readonly nextSlot = new Map<string, number>();
  private readonly fetchImpl: FetchLike;
  private readonly timeoutMs: number;
  private readonly minHostIntervalMs: number;
  private readonly retries: number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly userAgent: string;

  constructor(opts: HttpOptions = {}) {
    this.fetchImpl = opts.fetchImpl ?? ((url, init) => fetch(url, init));
    this.timeoutMs = opts.timeoutMs ?? 20_000;
    this.minHostIntervalMs = opts.minHostIntervalMs ?? 250;
    this.retries = opts.retries ?? 1;
    this.sleep = opts.sleep ?? realSleep;
    this.userAgent = opts.userAgent ?? USER_AGENT;
  }

  /** Reserve the next request slot for a host and wait for it. */
  private async waitForHost(url: string): Promise<void> {
    if (this.minHostIntervalMs <= 0) return;
    const host = new URL(url).host;
    const now = Date.now();
    const at = Math.max(now, this.nextSlot.get(host) ?? 0);
    this.nextSlot.set(host, at + this.minHostIntervalMs);
    if (at > now) await this.sleep(at - now);
  }

  async get(url: string, opts: GetOptions = {}): Promise<GetResult> {
    const as = opts.as ?? 'json';
    const headers: Record<string, string> = {
      'User-Agent': this.userAgent,
      Accept: as === 'json' ? 'application/json' : 'text/html,text/plain;q=0.9,*/*;q=0.5',
    };
    if (opts.etag) headers['If-None-Match'] = opts.etag;
    if (opts.lastModified) headers['If-Modified-Since'] = opts.lastModified;

    const fail = (status: number, error: string): GetResult => ({
      ok: false, status, notModified: false, body: null, etag: null, lastModified: null, error,
    });

    for (let attempt = 0; ; attempt++) {
      await this.waitForHost(url);
      let res: Response;
      try {
        res = await this.fetchImpl(url, { headers, redirect: 'follow', signal: AbortSignal.timeout(this.timeoutMs) });
      } catch (err) {
        if (attempt < this.retries) {
          await this.sleep(backoff(attempt));
          continue;
        }
        return fail(0, `network error: ${errorMessage(err)}`);
      }

      if (res.status === 304) {
        return {
          ok: true, status: 304, notModified: true, body: null,
          etag: res.headers.get('etag') ?? opts.etag ?? null,
          lastModified: res.headers.get('last-modified') ?? opts.lastModified ?? null,
          error: null,
        };
      }
      if ((res.status === 429 || res.status >= 500) && attempt < this.retries) {
        await res.body?.cancel().catch(() => {});
        await this.sleep(Math.min(retryAfterMs(res) ?? backoff(attempt), 30_000));
        continue;
      }

      let text: string;
      try {
        text = await res.text();
      } catch (err) {
        return fail(res.status, `failed reading body: ${errorMessage(err)}`);
      }
      if (!res.ok) return fail(res.status, `HTTP ${res.status}`);

      let body: unknown = text;
      if (as === 'json') {
        try {
          body = JSON.parse(text);
        } catch {
          return fail(res.status, 'response was not valid JSON');
        }
      }
      return {
        ok: true, status: res.status, notModified: false, body,
        etag: res.headers.get('etag'), lastModified: res.headers.get('last-modified'), error: null,
      };
    }
  }
}

function backoff(attempt: number): number {
  return 1000 * 2 ** attempt + Math.floor(Math.random() * 250);
}

function retryAfterMs(res: Response): number | null {
  const h = res.headers.get('retry-after');
  if (!h) return null;
  const secs = Number(h);
  if (Number.isFinite(secs)) return secs * 1000;
  const date = Date.parse(h);
  return Number.isNaN(date) ? null : Math.max(0, date - Date.now());
}

export function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.cause instanceof Error ? `${err.message} (${err.cause.message})` : err.message;
  return String(err);
}

/** Run `fn` over `items` with at most `concurrency` in flight; results keep input order. */
export async function mapPool<T, R>(
  items: readonly T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i] as T, i);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(concurrency, items.length)) }, worker));
  return results;
}
