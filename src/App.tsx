import { CSSProperties, useEffect, useRef, useState } from "react";
import { api } from "./lib/api";
import { SummaryView } from "./components/SummaryView";
import {
  NativeModelStatus,
  Page,
  SummaryFormat,
  SummaryMode,
  WorkspaceState
} from "./types";

const emptyWorkspace: WorkspaceState = {
  notebooks: [],
  pages: [],
  summaries: []
};

const summaryModes: Array<{ value: SummaryMode; label: string; description: string }> = [
  {
    value: "easy",
    label: "Easy",
    description: "Plain-language learning with simpler phrasing."
  },
  {
    value: "study",
    label: "Study",
    description: "Structured revision support for class prep."
  },
  {
    value: "exam",
    label: "Exam",
    description: "Sharper revision points for test situations."
  },
  {
    value: "deep",
    label: "Deep",
    description: "Linked concepts and higher-level understanding."
  },
  {
    value: "concise",
    label: "Concise",
    description: "Fast compression when time is short."
  },
  {
    value: "story",
    label: "Story",
    description: "Narrative learning with audio-ready explanation."
  }
];

const summaryFormats: Array<{
  value: SummaryFormat;
  label: string;
}> = [
  { value: "smart-notes", label: "Smart Notes" },
  { value: "bullets", label: "Bullets" },
  { value: "paragraph", label: "Paragraph" },
  { value: "flashcards", label: "Flashcards" },
  { value: "concept-map", label: "Concept Map" },
  { value: "storyboard", label: "Storyboard" }
];

const formatDate = (value: string) =>
  new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  }).format(new Date(value));

const countWords = (value: string) => value.trim().split(/\s+/).filter(Boolean).length;

const getErrorMessage = (error: unknown) =>
  error instanceof Error ? error.message : "Something went wrong.";

export default function App() {
  const [workspace, setWorkspace] = useState<WorkspaceState>(emptyWorkspace);
  const [selectedNotebookId, setSelectedNotebookId] = useState("");
  const [selectedPageId, setSelectedPageId] = useState("");
  const [draftTitle, setDraftTitle] = useState("");
  const [draftContent, setDraftContent] = useState("");
  const [selectionText, setSelectionText] = useState("");
  const [summaryScope, setSummaryScope] = useState<"page" | "selection">("page");
  const [summaryMode, setSummaryMode] = useState<SummaryMode>("easy");
  const [summaryFormat, setSummaryFormat] = useState<SummaryFormat>("smart-notes");
  const [selectedSummaryId, setSelectedSummaryId] = useState("");
  const [nativeModelStatus, setNativeModelStatus] = useState<NativeModelStatus | null>(null);
  const [loadingWorkspace, setLoadingWorkspace] = useState(true);
  const [busyMessage, setBusyMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved">("idle");

  const saveTimerRef = useRef<number | null>(null);
  const editorRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    const loadWorkspace = async () => {
      try {
        const [data, modelStatus] = await Promise.all([
          api.getWorkspace(),
          api.getNativeModelStatus().catch(() => null)
        ]);
        setWorkspace(data);
        setNativeModelStatus(modelStatus);
        setSelectedNotebookId(data.notebooks[0]?.id ?? "");

        const firstPage =
          data.pages.find((page) => page.notebookId === data.notebooks[0]?.id) ??
          data.pages[0];
        setSelectedPageId(firstPage?.id ?? "");
      } catch (error) {
        setErrorMessage(getErrorMessage(error));
      } finally {
        setLoadingWorkspace(false);
      }
    };

    void loadWorkspace();
  }, []);

  const notebookPages = workspace.pages
    .filter((page) => page.notebookId === selectedNotebookId)
    .sort(
      (left, right) =>
        new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime()
    );

  useEffect(() => {
    if (!selectedNotebookId && workspace.notebooks[0]) {
      setSelectedNotebookId(workspace.notebooks[0].id);
    }
  }, [selectedNotebookId, workspace.notebooks]);

  useEffect(() => {
    if (!selectedNotebookId) {
      return;
    }

    const activeExists = notebookPages.some((page) => page.id === selectedPageId);
    if (!activeExists) {
      setSelectedPageId(notebookPages[0]?.id ?? "");
    }
  }, [selectedNotebookId, selectedPageId, notebookPages]);

  const activePage = workspace.pages.find((page) => page.id === selectedPageId) ?? null;

  useEffect(() => {
    if (!activePage) {
      setDraftTitle("");
      setDraftContent("");
      setSelectionText("");
      return;
    }

    setDraftTitle(activePage.title);
    setDraftContent(activePage.content);
    setSelectionText("");
  }, [activePage?.id]);

  const activeSummaries = workspace.summaries
    .filter((summary) => summary.pageId === selectedPageId)
    .sort(
      (left, right) =>
        new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime()
    );

  useEffect(() => {
    if (!selectionText && summaryScope === "selection") {
      setSummaryScope("page");
    }
  }, [selectionText, summaryScope]);

  useEffect(() => {
    if (!selectedSummaryId && activeSummaries[0]) {
      setSelectedSummaryId(activeSummaries[0].id);
      return;
    }

    if (
      selectedSummaryId &&
      !activeSummaries.some((summary) => summary.id === selectedSummaryId)
    ) {
      setSelectedSummaryId(activeSummaries[0]?.id ?? "");
    }
  }, [activeSummaries, selectedSummaryId]);

  useEffect(() => {
    if (!activePage) {
      return;
    }

    if (draftTitle === activePage.title && draftContent === activePage.content) {
      return;
    }

    setSaveState("saving");

    if (saveTimerRef.current) {
      window.clearTimeout(saveTimerRef.current);
    }

    saveTimerRef.current = window.setTimeout(async () => {
      try {
        const saved = await api.updatePage(activePage.id, {
          title: draftTitle,
          content: draftContent
        });

        setWorkspace((current) => ({
          ...current,
          pages: current.pages.map((page) =>
            page.id === saved.id
              ? {
                  ...page,
                  title: draftTitle,
                  content: draftContent,
                  updatedAt: saved.updatedAt
                }
              : page
          )
        }));
        setSaveState("saved");
      } catch (error) {
        setErrorMessage(getErrorMessage(error));
        setSaveState("idle");
      }
    }, 650);

    return () => {
      if (saveTimerRef.current) {
        window.clearTimeout(saveTimerRef.current);
      }
    };
  }, [activePage, draftContent, draftTitle]);

  const persistCurrentDraft = async () => {
    if (!activePage) {
      return;
    }

    if (draftTitle === activePage.title && draftContent === activePage.content) {
      return;
    }

    if (saveTimerRef.current) {
      window.clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }

    const saved = await api.updatePage(activePage.id, {
      title: draftTitle,
      content: draftContent
    });

    setWorkspace((current) => ({
      ...current,
      pages: current.pages.map((page) =>
        page.id === saved.id
          ? {
              ...page,
              title: draftTitle,
              content: draftContent,
              updatedAt: saved.updatedAt
            }
          : page
      )
    }));
    setSaveState("saved");
  };

  const syncSelection = () => {
    if (!editorRef.current) {
      return;
    }

    const { selectionStart, selectionEnd } = editorRef.current;
    const selection = draftContent.slice(selectionStart, selectionEnd).trim();
    setSelectionText(selection);
  };

  const handleCreateNotebook = async () => {
    try {
      setErrorMessage("");
      setBusyMessage("Creating a fresh notebook and its first note...");
      await persistCurrentDraft();
      const notebookNumber = workspace.notebooks.length + 1;
      const notebook = await api.createNotebook({
        name: `Notebook ${notebookNumber}`,
        description: "A dedicated study space for a new subject or chapter."
      });
      const page = await api.createPage({
        notebookId: notebook.id,
        title: "First Note",
        content: "Start writing here. SNSAI will organize and transform the ideas when you are ready."
      });

      setWorkspace((current) => ({
        notebooks: [notebook, ...current.notebooks],
        pages: [page, ...current.pages],
        summaries: current.summaries
      }));
      setSelectedNotebookId(notebook.id);
      setSelectedPageId(page.id);
    } catch (error) {
      setErrorMessage(getErrorMessage(error));
    } finally {
      setBusyMessage("");
    }
  };

  const handleCreatePage = async () => {
    if (!selectedNotebookId) {
      return;
    }

    try {
      setErrorMessage("");
      setBusyMessage("Adding a new note page...");
      await persistCurrentDraft();
      const page = await api.createPage({
        notebookId: selectedNotebookId,
        title: `Note ${notebookPages.length + 1}`,
        content: ""
      });
      setWorkspace((current) => ({
        ...current,
        pages: [page, ...current.pages]
      }));
      setSelectedPageId(page.id);
    } catch (error) {
      setErrorMessage(getErrorMessage(error));
    } finally {
      setBusyMessage("");
    }
  };

  const handleDeletePage = async () => {
    if (!activePage || notebookPages.length <= 1) {
      return;
    }

    try {
      setErrorMessage("");
      setBusyMessage("Removing the current page...");
      await api.deletePage(activePage.id);
      setWorkspace((current) => ({
        ...current,
        pages: current.pages.filter((page) => page.id !== activePage.id),
        summaries: current.summaries.filter((summary) => summary.pageId !== activePage.id)
      }));
      const fallback = notebookPages.find((page) => page.id !== activePage.id);
      setSelectedPageId(fallback?.id ?? "");
    } catch (error) {
      setErrorMessage(getErrorMessage(error));
    } finally {
      setBusyMessage("");
    }
  };

  const handlePageChange = async (page: Page) => {
    try {
      await persistCurrentDraft();
    } catch (error) {
      setErrorMessage(getErrorMessage(error));
    }

    setSelectedPageId(page.id);
  };

  const handleSummarize = async () => {
    if (!selectedNotebookId || !activePage) {
      return;
    }

    try {
      setErrorMessage("");
      setBusyMessage("SNSAI is studying your note and preparing the response...");
      await persistCurrentDraft();
      const summary = await api.summarize({
        pageId: activePage.id,
        notebookId: selectedNotebookId,
        title: draftTitle,
        content: draftContent,
        selectionText: summaryScope === "selection" ? selectionText : undefined,
        mode: summaryMode,
        format: summaryFormat
      });

      setWorkspace((current) => ({
        ...current,
        summaries: [summary, ...current.summaries]
      }));
      setSelectedSummaryId(summary.id);
      setNativeModelStatus(await api.getNativeModelStatus().catch(() => nativeModelStatus));
    } catch (error) {
      setErrorMessage(getErrorMessage(error));
    } finally {
      setBusyMessage("");
    }
  };

  const handleTrainNativeModel = async () => {
    try {
      setErrorMessage("");
      setBusyMessage("SNSAI Native NLM is rebuilding itself from your local notes...");
      const status = await api.trainNativeModel();
      setNativeModelStatus(status);
    } catch (error) {
      setErrorMessage(getErrorMessage(error));
    } finally {
      setBusyMessage("");
    }
  };

  const currentSummary =
    activeSummaries.find((summary) => summary.id === selectedSummaryId) ?? null;

  if (loadingWorkspace) {
    return (
      <main className="app-shell">
        <section className="hero-card loading-card">
          <p className="eyebrow">SNSAI Loading</p>
          <h1>Preparing your note studio...</h1>
        </section>
      </main>
    );
  }

  return (
    <main className="app-shell">
      <section className="hero-card">
        <div>
          <p className="eyebrow">SNSAI Controlled Note System</p>
          <h1>Write notes, reshape them, and learn them as a story.</h1>
          <p className="hero-copy">
            This studio lets students create note pages, select any exact passage,
            and ask SNSAI to summarize it in different learning styles, including
            story mode with browser narration.
          </p>
        </div>
        <div className="hero-stat-grid">
          <article className="hero-stat">
            <strong>{workspace.notebooks.length}</strong>
            <span>Notebooks</span>
          </article>
          <article className="hero-stat">
            <strong>{workspace.pages.length}</strong>
            <span>Pages</span>
          </article>
          <article className="hero-stat">
            <strong>{workspace.summaries.length}</strong>
            <span>AI Outputs</span>
          </article>
        </div>
      </section>

      <section className="workspace-grid">
        <aside className="panel sidebar-panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Notebooks</p>
              <h2>Study Worlds</h2>
            </div>
            <button type="button" className="button-primary" onClick={handleCreateNotebook}>
              New Notebook
            </button>
          </div>

          <div className="stack">
            {workspace.notebooks.map((notebook) => (
              <button
                type="button"
                key={notebook.id}
                className={`list-card ${selectedNotebookId === notebook.id ? "active" : ""}`}
                onClick={() => setSelectedNotebookId(notebook.id)}
                style={{ "--accent-color": notebook.accent } as CSSProperties}
              >
                <span className="list-card-accent" />
                <div>
                  <strong>{notebook.name}</strong>
                  <p>{notebook.description}</p>
                </div>
              </button>
            ))}
          </div>

          <div className="panel-heading page-heading">
            <div>
              <p className="eyebrow">Pages</p>
              <h2>Note Pages</h2>
            </div>
            <div className="inline-actions">
              <button type="button" className="button-ghost" onClick={handleCreatePage}>
                Add Page
              </button>
              <button
                type="button"
                className="button-ghost"
                onClick={handleDeletePage}
                disabled={notebookPages.length <= 1}
              >
                Delete
              </button>
            </div>
          </div>

          <div className="stack compact">
            {notebookPages.map((page) => (
              <button
                type="button"
                key={page.id}
                className={`page-card ${selectedPageId === page.id ? "active" : ""}`}
                onClick={() => {
                  void handlePageChange(page);
                }}
              >
                <strong>{page.title}</strong>
                <span>Updated {formatDate(page.updatedAt)}</span>
              </button>
            ))}
          </div>
        </aside>

        <section className="panel editor-panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Editor</p>
              <h2>Write Your Note</h2>
            </div>
            <div className="chip-row">
              <span className="chip">{countWords(draftContent)} words</span>
              <span className="chip">
                {selectionText ? `${countWords(selectionText)} selected words` : "No selection"}
              </span>
              <span className={`chip ${saveState === "saving" ? "chip-live" : ""}`}>
                {saveState === "saving" ? "Saving..." : saveState === "saved" ? "Saved" : "Ready"}
              </span>
            </div>
          </div>

          <label className="field-label" htmlFor="title">
            Page Title
          </label>
          <input
            id="title"
            className="field"
            value={draftTitle}
            onChange={(event) => setDraftTitle(event.target.value)}
            placeholder="Give this note a strong title"
          />

          <label className="field-label" htmlFor="content">
            Note Content
          </label>
          <textarea
            id="content"
            ref={editorRef}
            className="editor-area"
            value={draftContent}
            onChange={(event) => setDraftContent(event.target.value)}
            onSelect={syncSelection}
            onKeyUp={syncSelection}
            onMouseUp={syncSelection}
            placeholder="Write lecture notes, book summaries, formulas, definitions, or rough ideas here..."
          />

          <div className="selection-banner">
            <strong>Selection Scope</strong>
            <p>
              {selectionText
                ? `"${selectionText.slice(0, 150)}${selectionText.length > 150 ? "..." : ""}"`
                : "Select any text in the editor to ask SNSAI for a focused summary."}
            </p>
          </div>
        </section>

        <aside className="panel ai-panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">AI Studio</p>
              <h2>SNSAI Modes</h2>
            </div>
            <button
              type="button"
              className="button-primary"
              onClick={handleSummarize}
              disabled={!draftContent.trim() || Boolean(busyMessage)}
            >
              {busyMessage ? "Thinking..." : "Summarize"}
            </button>
          </div>

          <div className="control-stack">
            {nativeModelStatus ? (
              <section className="mini-note native-model-panel">
                <div className="panel-heading small">
                  <div>
                    <p className="eyebrow">Your Own Model</p>
                    <h3>{nativeModelStatus.name}</h3>
                  </div>
                  <button
                    type="button"
                    className="button-ghost"
                    onClick={handleTrainNativeModel}
                    disabled={Boolean(busyMessage)}
                  >
                    Retrain
                  </button>
                </div>
                <p>{nativeModelStatus.note}</p>
                <div className="chip-row compact-row">
                  <span className="chip">{nativeModelStatus.documentCount} docs</span>
                  <span className="chip">{nativeModelStatus.vocabularySize} vocab</span>
                  <span className="chip">{nativeModelStatus.transitionCount} links</span>
                </div>
                {nativeModelStatus.topPhrases.length ? (
                  <div className="chip-row compact-row">
                    {nativeModelStatus.topPhrases.slice(0, 4).map((phrase) => (
                      <span className="chip" key={phrase}>
                        {phrase}
                      </span>
                    ))}
                  </div>
                ) : null}
              </section>
            ) : null}

            <label className="field-label" htmlFor="mode">
              Summary Mode
            </label>
            <select
              id="mode"
              className="field"
              value={summaryMode}
              onChange={(event) => setSummaryMode(event.target.value as SummaryMode)}
            >
              {summaryModes.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <p className="helper-copy">
              {summaryModes.find((item) => item.value === summaryMode)?.description}
            </p>

            <label className="field-label" htmlFor="format">
              Output Format
            </label>
            <select
              id="format"
              className="field"
              value={summaryFormat}
              onChange={(event) => setSummaryFormat(event.target.value as SummaryFormat)}
            >
              {summaryFormats.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>

            <div className="scope-toggle">
              <button
                type="button"
                className={summaryScope === "page" ? "scope-active" : ""}
                onClick={() => setSummaryScope("page")}
              >
                Whole Page
              </button>
              <button
                type="button"
                className={summaryScope === "selection" ? "scope-active" : ""}
                onClick={() => setSummaryScope("selection")}
                disabled={!selectionText}
              >
                Selected Text
              </button>
            </div>

            <div className="mini-note">
              SNSAI studies either the full page or just the highlighted text and
              generates structured explanations, questions, flashcards, and a story
              version when needed.
            </div>
          </div>

          {busyMessage ? <div className="status-banner">{busyMessage}</div> : null}
          {errorMessage ? <div className="error-banner">{errorMessage}</div> : null}

          <section className="summary-history">
            <div className="panel-heading small">
              <div>
                <p className="eyebrow">History</p>
                <h3>Recent Outputs</h3>
              </div>
            </div>
            <div className="stack compact">
              {activeSummaries.length ? (
                activeSummaries.map((summary) => (
                  <button
                    type="button"
                    key={summary.id}
                    className={`page-card ${selectedSummaryId === summary.id ? "active" : ""}`}
                    onClick={() => setSelectedSummaryId(summary.id)}
                  >
                    <strong>{summary.mode.toUpperCase()}</strong>
                    <span>
                      {summary.format} · {formatDate(summary.createdAt)}
                    </span>
                  </button>
                ))
              ) : (
                <div className="mini-note">
                  Your generated summaries will appear here for the active page.
                </div>
              )}
            </div>
          </section>

          {currentSummary ? (
            <SummaryView summary={currentSummary} />
          ) : (
            <div className="empty-state">
              <h3>No summary yet</h3>
              <p>
                Write a note, choose a mode, and ask SNSAI to transform it into
                something easier to revise and remember.
              </p>
            </div>
          )}
        </aside>
      </section>
    </main>
  );
}
