import {
  NativeModelStatus,
  Notebook,
  Page,
  StoryAudioFormat,
  SummaryFormat,
  SummaryMode,
  SummaryRecord,
  TtsStatus,
  WorkspaceState
} from "../types";

const trimTrailingSlash = (value: string) => value.replace(/\/+$/, "");

let resolvedApiBasePromise: Promise<string> | null = null;

const resolveApiBase = async () => {
  if (!resolvedApiBasePromise) {
    resolvedApiBasePromise = (async () => {
      const configuredBase = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.trim();
      if (configuredBase) {
        return trimTrailingSlash(configuredBase);
      }

      if (typeof window === "undefined") {
        return "";
      }

      const isLocalDevServer =
        ["localhost", "127.0.0.1"].includes(window.location.hostname) &&
        window.location.port === "5173";

      if (!isLocalDevServer) {
        return "";
      }

      const candidates = Array.from({ length: 12 }, (_, index) => `http://localhost:${8787 + index}`);

      for (const candidate of candidates) {
        try {
          const response = await fetch(`${candidate}/api/health`);
          if (response.ok) {
            return candidate;
          }
        } catch {
          continue;
        }
      }

      return "";
    })();
  }

  return resolvedApiBasePromise;
};

const buildUrl = async (url: string) => {
  const base = await resolveApiBase();
  return base ? `${base}${url}` : url;
};

const requestResponse = async (url: string, init?: RequestInit) => {
  const resolvedUrl = await buildUrl(url);
  const response = await fetch(resolvedUrl, {
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {})
    },
    ...init
  });

  if (!response.ok) {
    const errorBody = (await response.json().catch(() => null)) as
      | { message?: string }
      | null;
    throw new Error(errorBody?.message ?? "Request failed");
  }

  return response;
};

const request = async <T>(url: string, init?: RequestInit): Promise<T> => {
  const response = await requestResponse(url, init);

  if (response.status === 204) {
    return undefined as T;
  }

  return (await response.json()) as T;
};

const requestBlob = async (url: string, init?: RequestInit) => {
  const response = await requestResponse(url, init);
  return {
    blob: await response.blob(),
    headers: response.headers
  };
};

export const api = {
  getWorkspace: () => request<WorkspaceState>("/api/workspace"),
  createNotebook: (payload: { name: string; description?: string }) =>
    request<Notebook>("/api/notebooks", {
      method: "POST",
      body: JSON.stringify(payload)
    }),
  createPage: (payload: { notebookId: string; title?: string; content?: string }) =>
    request<Page>("/api/pages", {
      method: "POST",
      body: JSON.stringify(payload)
    }),
  updatePage: (pageId: string, payload: { title: string; content: string }) =>
    request<Page>(`/api/pages/${pageId}`, {
      method: "PATCH",
      body: JSON.stringify(payload)
    }),
  deletePage: (pageId: string) =>
    request<void>(`/api/pages/${pageId}`, {
      method: "DELETE"
    }),
  summarize: (payload: {
    pageId: string;
    notebookId: string;
    title: string;
    content: string;
    selectionText?: string;
    mode: SummaryMode;
    format: SummaryFormat;
  }) =>
    request<SummaryRecord>("/api/snsai/summarize", {
      method: "POST",
      body: JSON.stringify(payload)
    }),
  getTtsStatus: () => request<TtsStatus>("/api/snsai/tts/status"),
  getNativeModelStatus: () => request<NativeModelStatus>("/api/snsai/native-model/status"),
  trainNativeModel: () =>
    request<NativeModelStatus>("/api/snsai/native-model/train", {
      method: "POST"
    }),
  generateStoryAudio: (payload: {
    summaryId: string;
    voice?: string;
    format?: StoryAudioFormat;
    speed?: number;
  }) =>
    requestBlob("/api/snsai/story-audio", {
      method: "POST",
      body: JSON.stringify(payload)
    })
};
