import { Notebook, Page, WorkspaceData } from "../types";

const now = new Date().toISOString();

const starterNotebook: Notebook = {
  id: "notebook_welcome",
  name: "Learning Lab",
  description: "Your first notebook for class notes, ideas, and revision plans.",
  accent: "#0f766e",
  createdAt: now,
  updatedAt: now
};

const starterPage: Page = {
  id: "page_welcome",
  notebookId: starterNotebook.id,
  title: "Welcome to SNSAI",
  content: `SNSAI Note Studio is built for students who want to write, study, and understand faster.

Use this page to test the system:

1. Write your own notes in the editor.
2. Select a part of the note if you want a focused summary.
3. Choose a summary mode such as Easy, Study, Exam, Deep, or Story.
4. Pick the format you want, including flashcards and concept maps.
5. Let SNSAI reshape the material into clearer learning outputs.

Story mode is special. It turns the note into a guided learning narrative, then prepares an audio-ready script that can be spoken through the browser. This helps transform dry revision into something memorable.

Try replacing this page with real classroom notes and watch the AI studio react.`,
  createdAt: now,
  updatedAt: now
};

export const seedWorkspace = (): WorkspaceData => ({
  notebooks: [starterNotebook],
  pages: [starterPage],
  summaries: []
});
