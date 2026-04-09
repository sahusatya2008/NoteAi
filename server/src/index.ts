import express from "express";
import cors from "cors";
import http from "http";
import net from "net";
import path from "path";
import { promises as fs } from "fs";
import { WorkspaceStore } from "./data/store";
import {
  ensureNativeModel,
  getNativeModelStatus,
  retrainNativeModel
} from "./services/native-model";
import { generateSummary } from "./services/snsai/engine";
import { generateStoryAudio, getTtsStatus } from "./services/tts/native";
import { StoryAudioFormat, SummaryFormat, SummaryMode } from "./types";

const app = express();
const store = new WorkspaceStore();
const requestedPort = Number(process.env.PORT || 8787);
const hasExplicitPort = typeof process.env.PORT === "string" && process.env.PORT.trim().length > 0;
const clientDistPath = path.resolve(process.cwd(), "client-dist");
let activePort = requestedPort;

app.use(cors());
app.use(express.json({ limit: "3mb" }));

const assertNonEmpty = (value: unknown, fallbackMessage: string) => {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(fallbackMessage);
  }
  return value.trim();
};

const isSummaryMode = (value: unknown): value is SummaryMode =>
  ["concise", "easy", "study", "exam", "deep", "story"].includes(String(value));

const isSummaryFormat = (value: unknown): value is SummaryFormat =>
  ["smart-notes", "bullets", "paragraph", "flashcards", "concept-map", "storyboard"].includes(
    String(value)
  );

const isStoryAudioFormat = (value: unknown): value is StoryAudioFormat =>
  ["mp3", "wav", "opus"].includes(String(value));

app.get("/api/health", async (_request, response) => {
  response.json({ ok: true, port: activePort, tts: await getTtsStatus() });
});

app.get("/api/workspace", async (_request, response, next) => {
  try {
    response.json(await store.getWorkspace());
  } catch (error) {
    next(error);
  }
});

app.post("/api/notebooks", async (request, response, next) => {
  try {
    const notebook = await store.createNotebook({
      name: assertNonEmpty(request.body.name, "Notebook name is required."),
      description: request.body.description,
      accent: request.body.accent
    });

    response.status(201).json(notebook);
  } catch (error) {
    next(error);
  }
});

app.patch("/api/notebooks/:notebookId", async (request, response, next) => {
  try {
    const notebook = await store.updateNotebook(request.params.notebookId, {
      name: request.body.name,
      description: request.body.description,
      accent: request.body.accent
    });

    response.json(notebook);
  } catch (error) {
    next(error);
  }
});

app.post("/api/pages", async (request, response, next) => {
  try {
    const page = await store.createPage({
      notebookId: assertNonEmpty(request.body.notebookId, "Notebook id is required."),
      title: request.body.title,
      content: request.body.content
    });

    response.status(201).json(page);
  } catch (error) {
    next(error);
  }
});

app.patch("/api/pages/:pageId", async (request, response, next) => {
  try {
    const page = await store.updatePage(request.params.pageId, {
      title: request.body.title,
      content: request.body.content
    });

    response.json(page);
  } catch (error) {
    next(error);
  }
});

app.delete("/api/pages/:pageId", async (request, response, next) => {
  try {
    await store.deletePage(request.params.pageId);
    response.status(204).send();
  } catch (error) {
    next(error);
  }
});

app.post("/api/snsai/summarize", async (request, response, next) => {
  try {
    await ensureNativeModel(store);

    if (!isSummaryMode(request.body.mode)) {
      throw new Error("Invalid SNSAI mode.");
    }

    if (!isSummaryFormat(request.body.format)) {
      throw new Error("Invalid SNSAI format.");
    }

    const summary = generateSummary({
      pageId: assertNonEmpty(request.body.pageId, "Page id is required."),
      notebookId: assertNonEmpty(request.body.notebookId, "Notebook id is required."),
      title: typeof request.body.title === "string" ? request.body.title : "Untitled Note",
      content: typeof request.body.content === "string" ? request.body.content : "",
      selectionText:
        typeof request.body.selectionText === "string"
          ? request.body.selectionText
          : undefined,
      mode: request.body.mode,
      format: request.body.format
    });

    const savedSummary = await store.saveSummary(summary);
    await retrainNativeModel(store);
    response.status(201).json(savedSummary);
  } catch (error) {
    next(error);
  }
});

app.get("/api/snsai/native-model/status", async (_request, response, next) => {
  try {
    response.json(await getNativeModelStatus(store));
  } catch (error) {
    next(error);
  }
});

app.post("/api/snsai/native-model/train", async (_request, response, next) => {
  try {
    response.json(await retrainNativeModel(store));
  } catch (error) {
    next(error);
  }
});

app.get("/api/snsai/tts/status", async (_request, response, next) => {
  try {
    response.json(await getTtsStatus());
  } catch (error) {
    next(error);
  }
});

app.post("/api/snsai/story-audio", async (request, response, next) => {
  try {
    const summaryId = assertNonEmpty(request.body.summaryId, "Summary id is required.");
    const summary = await store.getSummary(summaryId);

    if (!summary) {
      throw new Error("Summary not found for story audio export.");
    }

    if (!summary.artifact.story) {
      throw new Error("This summary does not have story audio content yet.");
    }

    const audio = await generateStoryAudio(summary, {
      voice: typeof request.body.voice === "string" ? request.body.voice : undefined,
      format: isStoryAudioFormat(request.body.format) ? request.body.format : "mp3",
      speed:
        typeof request.body.speed === "number" && Number.isFinite(request.body.speed)
          ? request.body.speed
          : undefined
    });

    response.setHeader("Content-Type", audio.contentType);
    response.setHeader("Content-Disposition", `inline; filename="${audio.fileName}"`);
    response.setHeader("X-SNSAI-TTS-Provider", audio.provider);
    response.setHeader("X-SNSAI-TTS-Model", audio.model);
    response.setHeader("X-SNSAI-TTS-Voice", audio.voice);
    response.setHeader("X-SNSAI-TTS-Trimmed", String(audio.trimmed));
    response.send(audio.audioBuffer);
  } catch (error) {
    next(error);
  }
});

app.use("/api", (_request, response) => {
  response.status(404).json({ message: "API route not found." });
});

const serveClient = async () => {
  try {
    await fs.access(clientDistPath);
    app.use(express.static(clientDistPath));
    app.get("*", async (_request, response) => {
      response.sendFile(path.join(clientDistPath, "index.html"));
    });
  } catch {
    app.get("/", (_request, response) => {
      response.send("SNSAI server is running. Start the Vite client in development mode.");
    });
  }
};

app.use(
  (
    error: unknown,
    _request: express.Request,
    response: express.Response,
    _next: express.NextFunction
  ) => {
    const message =
      error instanceof Error ? error.message : "Unexpected server failure";
    response.status(400).json({ message });
  }
);

serveClient().then(() => {
  const server = http.createServer(app);

  const isPortAvailable = (port: number) =>
    new Promise<boolean>((resolve, reject) => {
      const tester = net.createServer();

      tester.once("error", (error: NodeJS.ErrnoException) => {
        if (error.code === "EADDRINUSE") {
          resolve(false);
          return;
        }

        reject(error);
      });

      tester.once("listening", () => {
        tester.close(() => resolve(true));
      });

      tester.listen(port);
    });

  const listenOnPort = (port: number) =>
    new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(port, () => {
        server.off("error", reject);
        resolve();
      });
    });

  const start = async () => {
    let port = requestedPort;
    let movedFromRequestedPort = false;

    while (true) {
      if (!hasExplicitPort) {
        const available = await isPortAvailable(port);
        if (!available) {
          movedFromRequestedPort = true;
          port += 1;

          if (port > requestedPort + 40) {
            throw Object.assign(
              new Error(`No free port found from ${requestedPort} to ${requestedPort + 40}.`),
              { code: "EADDRINUSE" }
            );
          }

          continue;
        }
      }

      try {
        activePort = port;
        await listenOnPort(port);

        if (!hasExplicitPort && movedFromRequestedPort) {
          console.log(
            `Port ${requestedPort} was busy, so SNSAI moved to http://localhost:${port}`
          );
        }

        console.log(`SNSAI Note Studio server running on http://localhost:${activePort}`);
        return;
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (!hasExplicitPort && code === "EADDRINUSE") {
          movedFromRequestedPort = true;
          port += 1;

          if (port > requestedPort + 40) {
            throw error;
          }

          continue;
        }

        throw error;
      }
    }
  };

  void start().catch((error) => {
    if (
      error instanceof Error &&
      "code" in error &&
      (error as NodeJS.ErrnoException).code === "EADDRINUSE"
    ) {
      console.error(
        hasExplicitPort
          ? `Port ${requestedPort} is already in use. Choose another one with PORT=<port>.`
          : `SNSAI could not find a free port starting from ${requestedPort}.`
      );
      process.exit(1);
    }

    console.error(error);
    process.exit(1);
  });
});
