# SNSAI Note Studio

A web-based note making system where students can create notebooks, write note pages, select exact note sections, and ask SNSAI to summarize the content in multiple learning modes and output formats.

## Features

- Create notebooks and note pages
- Write and autosave notes in a focused editor
- Summarize an entire page or only the selected text
- Choose SNSAI modes:
  - `Easy`
  - `Study`
  - `Exam`
  - `Deep`
  - `Concise`
  - `Story`
- Choose summary formats:
  - `Smart Notes`
  - `Bullets`
  - `Paragraph`
  - `Flashcards`
  - `Concept Map`
  - `Storyboard`
- Story mode generates an audio-ready script and can play it through the browser speech engine
- JSON-backed persistence with seed content on first run

## Tech Stack

- Frontend: React + Vite + TypeScript
- Backend: Express + TypeScript
- Storage: custom JSON workspace store
- AI layer: custom local SNSAI summarization engine
- Local SNSAI native language-model layer for summary phrasing and note adaptation

## Run Locally

```bash
npm install
npm run dev
```

This starts:

- Vite frontend on `http://localhost:5173`
- SNSAI API server on `http://localhost:8787`

If `8787` is already in use, the SNSAI server automatically moves to the next free
local port. The frontend can discover that server during local development.

## Production Build

```bash
npm run build
npm start
```

The production server serves the built frontend from the same Express app. If `8787`
is busy, `npm start` automatically shifts to the next free port and prints the final URL.

## SNSAI Native Model

SNSAI now includes a local native language-model layer that trains on your own notes
and generated study material. It is used to improve phrasing selection inside the
summary engine and can be retrained from the app.

The AI panel shows:

- local document count
- vocabulary size
- transition links inside the model
- top learned phrases from your workspace

You can also retrain it directly from the terminal:

```bash
npm run train:model
```

## Project Structure

```text
src/                     Frontend app
src/components/          UI components including summary and audio narration
src/lib/                 API client
server/src/              Express API and SNSAI engine
server/src/data/         Seed data and file store
server/src/services/     SNSAI summarization logic
data/                    Runtime workspace file, created automatically
```

## Notes

- The current SNSAI engine is local and deterministic, so the app works without a cloud AI dependency.
- Browser/device narration still works for instant story playback.
- If you want to take SNSAI further later, the backend is now organized around your own local model stack instead of only static heuristics.
# SNSX-AI-Ecommerce-System
# NoteAI
