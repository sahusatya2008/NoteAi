import { promises as fs } from "fs";
import path from "path";
import crypto from "crypto";
import { seedWorkspace } from "./seed";
import { Notebook, Page, SummaryRecord, WorkspaceData } from "../types";

const DATA_DIR = path.resolve(process.cwd(), "data");
const WORKSPACE_FILE = path.join(DATA_DIR, "workspace.json");

const randomAccent = () => {
  const accents = ["#0f766e", "#b45309", "#1d4ed8", "#7c3aed", "#be123c"];
  return accents[Math.floor(Math.random() * accents.length)];
};

const createId = (prefix: string) =>
  `${prefix}_${crypto.randomUUID().slice(0, 8)}`;

export class WorkspaceStore {
  private writeQueue: Promise<void> = Promise.resolve();

  private async ensureWorkspaceFile(): Promise<void> {
    await fs.mkdir(DATA_DIR, { recursive: true });

    try {
      await fs.access(WORKSPACE_FILE);
    } catch {
      await this.writeWorkspace(seedWorkspace());
    }
  }

  private async readWorkspace(): Promise<WorkspaceData> {
    await this.ensureWorkspaceFile();
    const raw = await fs.readFile(WORKSPACE_FILE, "utf8");
    return JSON.parse(raw) as WorkspaceData;
  }

  private async writeWorkspace(workspace: WorkspaceData): Promise<void> {
    const tmpPath = `${WORKSPACE_FILE}.${crypto.randomUUID()}.tmp`;
    await fs.writeFile(tmpPath, JSON.stringify(workspace, null, 2), "utf8");
    await fs.rename(tmpPath, WORKSPACE_FILE);
  }

  private async mutate<T>(
    mutation: (workspace: WorkspaceData) => T | Promise<T>
  ): Promise<T> {
    const run = async () => {
      const workspace = await this.readWorkspace();
      const result = await mutation(workspace);
      await this.writeWorkspace(workspace);
      return result;
    };

    const resultPromise = this.writeQueue.then(run);
    this.writeQueue = resultPromise.then(
      () => undefined,
      () => undefined
    );
    return resultPromise;
  }

  async getWorkspace(): Promise<WorkspaceData> {
    return this.readWorkspace();
  }

  async getSummary(summaryId: string): Promise<SummaryRecord | null> {
    const workspace = await this.readWorkspace();
    return workspace.summaries.find((summary) => summary.id === summaryId) ?? null;
  }

  async createNotebook(input: {
    name: string;
    description?: string;
    accent?: string;
  }): Promise<Notebook> {
    return this.mutate((workspace) => {
      const now = new Date().toISOString();
      const notebook: Notebook = {
        id: createId("notebook"),
        name: input.name.trim(),
        description: (input.description ?? "A focused notebook for your next study mission.").trim(),
        accent: input.accent?.trim() || randomAccent(),
        createdAt: now,
        updatedAt: now
      };

      workspace.notebooks.unshift(notebook);
      return notebook;
    });
  }

  async updateNotebook(
    notebookId: string,
    updates: Partial<Pick<Notebook, "name" | "description" | "accent">>
  ): Promise<Notebook> {
    return this.mutate((workspace) => {
      const notebook = workspace.notebooks.find((item) => item.id === notebookId);
      if (!notebook) {
        throw new Error("Notebook not found");
      }

      if (typeof updates.name === "string" && updates.name.trim()) {
        notebook.name = updates.name.trim();
      }

      if (typeof updates.description === "string") {
        notebook.description = updates.description.trim();
      }

      if (typeof updates.accent === "string" && updates.accent.trim()) {
        notebook.accent = updates.accent.trim();
      }

      notebook.updatedAt = new Date().toISOString();
      return notebook;
    });
  }

  async createPage(input: {
    notebookId: string;
    title?: string;
    content?: string;
  }): Promise<Page> {
    return this.mutate((workspace) => {
      const notebook = workspace.notebooks.find(
        (item) => item.id === input.notebookId
      );
      if (!notebook) {
        throw new Error("Notebook not found");
      }

      const now = new Date().toISOString();
      const page: Page = {
        id: createId("page"),
        notebookId: input.notebookId,
        title: input.title?.trim() || "Untitled Note",
        content: input.content ?? "",
        createdAt: now,
        updatedAt: now
      };

      workspace.pages.unshift(page);
      notebook.updatedAt = now;
      return page;
    });
  }

  async updatePage(
    pageId: string,
    updates: Partial<Pick<Page, "title" | "content">>
  ): Promise<Page> {
    return this.mutate((workspace) => {
      const page = workspace.pages.find((item) => item.id === pageId);
      if (!page) {
        throw new Error("Page not found");
      }

      if (typeof updates.title === "string") {
        page.title = updates.title.trim() || "Untitled Note";
      }

      if (typeof updates.content === "string") {
        page.content = updates.content;
      }

      page.updatedAt = new Date().toISOString();
      return page;
    });
  }

  async deletePage(pageId: string): Promise<void> {
    await this.mutate((workspace) => {
      workspace.pages = workspace.pages.filter((item) => item.id !== pageId);
      workspace.summaries = workspace.summaries.filter(
        (item) => item.pageId !== pageId
      );
    });
  }

  async saveSummary(summary: SummaryRecord): Promise<SummaryRecord> {
    return this.mutate((workspace) => {
      workspace.summaries.unshift(summary);
      workspace.summaries = workspace.summaries.slice(0, 60);
      return summary;
    });
  }
}
