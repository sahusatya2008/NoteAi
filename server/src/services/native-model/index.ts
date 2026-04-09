import { promises as fs } from "fs";
import path from "path";
import { WorkspaceStore } from "../../data/store";
import { NativeModelStatus, WorkspaceData } from "../../types";
import { normalizeWhitespace, splitSentences, tokenize, uniqueOrdered } from "../snsai/text";

interface NativeModelSnapshot {
  version: number;
  name: string;
  trainedAt: string;
  documentCount: number;
  sentenceCount: number;
  vocabularySize: number;
  transitionCount: number;
  phraseCount: number;
  topPhrases: string[];
  starters: Record<string, number>;
  bigrams: Record<string, Record<string, number>>;
  trigrams: Record<string, Record<string, number>>;
  phraseScores: Record<string, number>;
}

const DATA_DIR = path.resolve(process.cwd(), "data");
const MODEL_FILE = path.join(DATA_DIR, "snsai-native-model.json");
const MODEL_NAME = "SNSAI Native NLM";

let activeSnapshot: NativeModelSnapshot | null = null;

const languageTokens = (value: string) =>
  value
    .toLowerCase()
    .match(/[a-z0-9']+|[.,!?;:]/g)
    ?.filter(Boolean) ?? [];

const collectDocuments = (workspace: WorkspaceData) =>
  [
    ...workspace.pages.map((page) => `${page.title}. ${page.content}`),
    ...workspace.summaries.flatMap((summary) => [
      summary.artifact.directSummary,
      summary.artifact.overview,
      ...summary.artifact.bullets,
      ...(summary.artifact.quickTakeaways ?? []),
      ...(summary.artifact.story?.scenes ?? []),
      summary.artifact.story?.takeaway ?? ""
    ])
  ]
    .map((item) => normalizeWhitespace(String(item ?? "")))
    .filter(Boolean);

const trainSnapshot = (workspace: WorkspaceData): NativeModelSnapshot => {
  const documents = collectDocuments(workspace);
  const starters = new Map<string, number>();
  const bigrams = new Map<string, Map<string, number>>();
  const trigrams = new Map<string, Map<string, number>>();
  const vocabulary = new Set<string>();
  const phraseScores = new Map<string, number>();
  let sentenceCount = 0;

  const addTransition = (
    store: Map<string, Map<string, number>>,
    key: string,
    next: string
  ) => {
    const bucket = store.get(key) ?? new Map<string, number>();
    bucket.set(next, (bucket.get(next) ?? 0) + 1);
    store.set(key, bucket);
  };

  const addPhrase = (phrase: string, score: number) => {
    if (!phrase || phrase.length < 6 || phrase.length > 64) {
      return;
    }

    phraseScores.set(phrase, (phraseScores.get(phrase) ?? 0) + score);
  };

  for (const document of documents) {
    const sentences = splitSentences(document);

    for (const sentence of sentences) {
      const tokens = languageTokens(sentence);
      if (tokens.length < 2) {
        continue;
      }

      sentenceCount += 1;
      starters.set(tokens[0], (starters.get(tokens[0]) ?? 0) + 1);

      const sequence = ["<s1>", "<s2>", ...tokens, "</s>"];
      for (const token of tokens) {
        vocabulary.add(token);
      }

      for (let index = 2; index < sequence.length; index += 1) {
        addTransition(bigrams, sequence[index - 1], sequence[index]);
        addTransition(
          trigrams,
          `${sequence[index - 2]} ${sequence[index - 1]}`,
          sequence[index]
        );
      }

      const phraseTokens = tokenize(sentence);
      for (let size = 2; size <= 4; size += 1) {
        for (let index = 0; index <= phraseTokens.length - size; index += 1) {
          addPhrase(phraseTokens.slice(index, index + size).join(" "), size - 1);
        }
      }
    }
  }

  const serializeTransitions = (store: Map<string, Map<string, number>>) =>
    Object.fromEntries(
      [...store.entries()].map(([key, bucket]) => [key, Object.fromEntries(bucket.entries())])
    );

  const topPhrases = [...phraseScores.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, 12)
    .map(([phrase]) => phrase);

  return {
    version: 1,
    name: MODEL_NAME,
    trainedAt: new Date().toISOString(),
    documentCount: documents.length,
    sentenceCount,
    vocabularySize: vocabulary.size,
    transitionCount:
      [...bigrams.values()].reduce((total, bucket) => total + bucket.size, 0) +
      [...trigrams.values()].reduce((total, bucket) => total + bucket.size, 0),
    phraseCount: phraseScores.size,
    topPhrases,
    starters: Object.fromEntries(starters.entries()),
    bigrams: serializeTransitions(bigrams),
    trigrams: serializeTransitions(trigrams),
    phraseScores: Object.fromEntries(phraseScores.entries())
  };
};

const statusFromSnapshot = (snapshot: NativeModelSnapshot): NativeModelStatus => ({
  name: snapshot.name,
  ready: true,
  trainedAt: snapshot.trainedAt,
  documentCount: snapshot.documentCount,
  sentenceCount: snapshot.sentenceCount,
  vocabularySize: snapshot.vocabularySize,
  transitionCount: snapshot.transitionCount,
  phraseCount: snapshot.phraseCount,
  topPhrases: snapshot.topPhrases.slice(0, 6).map((phrase) => phrase.replace(/\b\w/g, (letter) => letter.toUpperCase())),
  note: "SNSAI Native NLM is training only on your local notes and generated study material."
});

const persistSnapshot = async (snapshot: NativeModelSnapshot) => {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(MODEL_FILE, JSON.stringify(snapshot, null, 2), "utf8");
};

const readSnapshot = async () => {
  if (activeSnapshot) {
    return activeSnapshot;
  }

  try {
    const raw = await fs.readFile(MODEL_FILE, "utf8");
    activeSnapshot = JSON.parse(raw) as NativeModelSnapshot;
    return activeSnapshot;
  } catch {
    return null;
  }
};

export const ensureNativeModel = async (store: WorkspaceStore) => {
  const existing = await readSnapshot();
  if (existing) {
    return existing;
  }

  const workspace = await store.getWorkspace();
  const snapshot = trainSnapshot(workspace);
  activeSnapshot = snapshot;
  await persistSnapshot(snapshot);
  return snapshot;
};

export const retrainNativeModel = async (store: WorkspaceStore) => {
  const workspace = await store.getWorkspace();
  const snapshot = trainSnapshot(workspace);
  activeSnapshot = snapshot;
  await persistSnapshot(snapshot);
  return statusFromSnapshot(snapshot);
};

export const getNativeModelStatus = async (store: WorkspaceStore): Promise<NativeModelStatus> =>
  statusFromSnapshot(await ensureNativeModel(store));

const phraseCoverageBonus = (value: string, snapshot: NativeModelSnapshot, topic: string) => {
  const normalized = normalizeWhitespace(value).toLowerCase();
  const topicTokens = tokenize(topic);
  const topicBonus = topicTokens.reduce(
    (total, token) => total + (normalized.includes(token) ? 1.2 : 0),
    0
  );
  const phraseBonus = uniqueOrdered(
    Object.keys(snapshot.phraseScores).filter((phrase) => normalized.includes(phrase))
  ).reduce((total, phrase) => total + Math.min(4, (snapshot.phraseScores[phrase] ?? 0) / 4), 0);

  return topicBonus + phraseBonus;
};

const scoreText = (value: string, snapshot: NativeModelSnapshot, topic: string) => {
  const tokens = languageTokens(value);
  if (!tokens.length) {
    return Number.NEGATIVE_INFINITY;
  }

  const sequence = ["<s1>", "<s2>", ...tokens, "</s>"];
  let score = 0;

  for (let index = 2; index < sequence.length; index += 1) {
    const trigramKey = `${sequence[index - 2]} ${sequence[index - 1]}`;
    const trigramBucket = snapshot.trigrams[trigramKey];
    const bigramBucket = snapshot.bigrams[sequence[index - 1]];
    const next = sequence[index];

    if (trigramBucket?.[next]) {
      score += Math.log(1 + trigramBucket[next]) * 2.2;
      continue;
    }

    if (bigramBucket?.[next]) {
      score += Math.log(1 + bigramBucket[next]) * 1.4;
      continue;
    }

    score -= 1.75;
  }

  return score + phraseCoverageBonus(value, snapshot, topic) - tokens.length * 0.02;
};

const normalizeCandidate = (value: string) =>
  normalizeWhitespace(value)
    .replace(/\s+([,.!?;:])/g, "$1")
    .replace(/\.\s*\./g, ".")
    .trim();

const dedupeRepeatedClauses = (value: string) => {
  const sentences = splitSentences(value);
  if (sentences.length <= 1) {
    return value;
  }

  const deduped: string[] = [];
  for (const sentence of sentences) {
    const normalized = normalizeWhitespace(sentence).toLowerCase();
    if (deduped.some((existing) => normalizeWhitespace(existing).toLowerCase() === normalized)) {
      continue;
    }
    deduped.push(sentence);
  }

  return deduped.join(" ");
};

export const chooseBestNativeVariant = (input: {
  topic: string;
  variants: string[];
  fallback: string;
}) => {
  const snapshot = activeSnapshot;
  const cleaned = uniqueOrdered(
    input.variants
      .map((item) => normalizeCandidate(dedupeRepeatedClauses(item)))
      .filter(Boolean)
  );

  if (!snapshot || cleaned.length <= 1) {
    return cleaned[0] ?? input.fallback;
  }

  let best = cleaned[0];
  let bestScore = scoreText(cleaned[0], snapshot, input.topic);

  for (const candidate of cleaned.slice(1)) {
    const candidateScore = scoreText(candidate, snapshot, input.topic);
    if (candidateScore > bestScore) {
      best = candidate;
      bestScore = candidateScore;
    }
  }

  return best;
};

export const getNativeModelName = () =>
  activeSnapshot?.name ?? MODEL_NAME;
