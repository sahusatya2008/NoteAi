export type SummaryMode =
  | "concise"
  | "easy"
  | "study"
  | "exam"
  | "deep"
  | "story";

export type SummaryFormat =
  | "smart-notes"
  | "bullets"
  | "paragraph"
  | "flashcards"
  | "concept-map"
  | "storyboard";

export interface Notebook {
  id: string;
  name: string;
  description: string;
  accent: string;
  createdAt: string;
  updatedAt: string;
}

export interface Page {
  id: string;
  notebookId: string;
  title: string;
  content: string;
  createdAt: string;
  updatedAt: string;
}

export interface KeyConcept {
  term: string;
  explanation: string;
  importance?: string;
  memoryHook?: string;
}

export interface Flashcard {
  front: string;
  back: string;
}

export interface SectionInsight {
  title: string;
  gist: string;
  focusPoints: string[];
}

export interface StoryCharacter {
  name: string;
  role: string;
  represents: string;
}

export interface StoryBeat {
  title: string;
  narration: string;
  learningPoint: string;
  chapterLabel?: string;
  audioNarration?: string;
  focus?: string;
}

export interface NarrationSegment {
  id: string;
  label: string;
  text: string;
  intent: "warm" | "guide" | "emphasis" | "reflection" | "celebration";
  rate: number;
  pitch: number;
  volume: number;
  pauseAfterMs: number;
}

export type StoryAudioFormat = "mp3" | "wav" | "opus";

export interface TtsVoiceOption {
  id: string;
  label: string;
  tone: string;
}

export interface TtsStatus {
  provider: "native" | "none";
  available: boolean;
  model: string;
  defaultVoice: string;
  formats: StoryAudioFormat[];
  voices: TtsVoiceOption[];
  message: string;
}

export interface NativeModelStatus {
  name: string;
  ready: boolean;
  trainedAt: string;
  documentCount: number;
  sentenceCount: number;
  vocabularySize: number;
  transitionCount: number;
  phraseCount: number;
  topPhrases: string[];
  note: string;
}

export interface StoryArtifact {
  title: string;
  hook: string;
  prologue?: string;
  storyArc?: string[];
  setting?: string;
  narrator?: string;
  voiceStyle?: string;
  characters?: StoryCharacter[];
  beats?: StoryBeat[];
  scenes: string[];
  takeaway: string;
  reflection?: string;
  deliveryNotes?: string[];
  listeningTips?: string[];
  interactivePrompts?: string[];
  audioSegments?: NarrationSegment[];
  audioScript: string;
}

export interface SummaryArtifact {
  title: string;
  mode: SummaryMode;
  format: SummaryFormat;
  engine: string;
  sourceScope: "page" | "selection";
  sourcePreview: string;
  directSummary: string;
  overview: string;
  bullets: string[];
  quickTakeaways?: string[];
  formatGuide?: string;
  keyConcepts: KeyConcept[];
  sectionInsights?: SectionInsight[];
  relationships?: string[];
  learningPath?: string[];
  examSignals?: string[];
  memoryHooks?: string[];
  flashcards: Flashcard[];
  conceptMap: string[];
  studyQuestions: string[];
  story?: StoryArtifact;
  rendered: string;
  metrics: {
    wordCount: number;
    sentenceCount: number;
    readingTimeMinutes: number;
  };
}

export interface SummaryRecord {
  id: string;
  pageId: string;
  notebookId: string;
  mode: SummaryMode;
  format: SummaryFormat;
  sourceScope: "page" | "selection";
  sourceSelection: string;
  createdAt: string;
  artifact: SummaryArtifact;
}

export interface WorkspaceData {
  notebooks: Notebook[];
  pages: Page[];
  summaries: SummaryRecord[];
}
