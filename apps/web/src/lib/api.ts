import type { ApiErrorBody, ErrorCode, ErrorParams } from '@erp/shared';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: ErrorCode,
    readonly params: ErrorParams = {},
    readonly issues: { path: string; message: string }[] = [],
  ) {
    super(code);
  }
}

let currentCompanyId: string | null = null;

/** The selected company is sent on every request; the API validates it against the tenant. */
export const setApiCompany = (companyId: string | null): void => {
  currentCompanyId = companyId;
};

type Options = { method?: string; body?: unknown; query?: Record<string, string | number | boolean | undefined | null> };

const buildUrl = (path: string, query?: Options['query']): string => {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value !== undefined && value !== null && value !== '') params.set(key, String(value));
  }
  const qs = params.toString();
  return `/api${path}${qs ? `?${qs}` : ''}`;
};

const headers = (json: boolean): HeadersInit => ({
  ...(json ? { 'Content-Type': 'application/json' } : {}),
  ...(currentCompanyId ? { 'X-Company-Id': currentCompanyId } : {}),
});

const failure = async (res: Response): Promise<never> => {
  const body = (await res.json().catch(() => null)) as ApiErrorBody | null;
  throw new ApiError(res.status, body?.error.code ?? 'INTERNAL', body?.error.params, body?.error.issues);
};

export const api = async <T>(path: string, options: Options = {}): Promise<T> => {
  const res = await fetch(buildUrl(path, options.query), {
    method: options.method ?? 'GET',
    headers: headers(options.body !== undefined),
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    credentials: 'same-origin',
  });
  if (!res.ok) return failure(res);
  return (await res.json()) as T;
};

export const upload = async <T>(path: string, file: File): Promise<T> => {
  const form = new FormData();
  form.append('file', file);
  const res = await fetch(buildUrl(path), { method: 'POST', headers: headers(false), body: form, credentials: 'same-origin' });
  if (!res.ok) return failure(res);
  return (await res.json()) as T;
};

/** Downloads a binary response (PDF / Excel / attachment) and hands it to the browser. */
export const download = async (path: string, query: Options['query'], fallbackName: string): Promise<void> => {
  const res = await fetch(buildUrl(path, query), { headers: headers(false), credentials: 'same-origin' });
  if (!res.ok) return failure(res);
  const blob = await res.blob();
  const disposition = res.headers.get('Content-Disposition') ?? '';
  const match = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(disposition);
  const name = match?.[1] ? decodeURIComponent(match[1]) : fallbackName;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
};
