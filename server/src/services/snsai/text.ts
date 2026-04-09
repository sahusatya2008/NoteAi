import { STOPWORDS } from "./stopwords";

export const normalizeWhitespace = (value: string) =>
  value.replace(/\r/g, "").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();

export const normalizeLineEndings = (value: string) => value.replace(/\r/g, "");

export const splitParagraphs = (value: string) =>
  normalizeWhitespace(value)
    .split(/\n{2,}/)
    .map((item) => item.trim())
    .filter(Boolean);

export const splitLines = (value: string) =>
  normalizeLineEndings(value)
    .split("\n")
    .map((item) => item.replace(/[ \t]+/g, " ").trim());

export const splitSentences = (value: string) =>
  normalizeWhitespace(value)
    .split(/(?<=[.!?])\s+/)
    .map((item) => item.trim())
    .filter(Boolean);

export const tokenize = (value: string) =>
  value
    .toLowerCase()
    .match(/[a-z][a-z'-]+/g)
    ?.filter((token) => token.length > 2 && !STOPWORDS.has(token)) ?? [];

export const uniqueOrdered = <T>(values: T[]) => [...new Set(values)];

export const estimateReadingTime = (wordCount: number) =>
  Math.max(1, Math.round(wordCount / 180));

export const topKeywords = (tokens: string[], limit = 8) => {
  const counts = new Map<string, number>();

  for (const token of tokens) {
    counts.set(token, (counts.get(token) ?? 0) + 1);
  }

  return [...counts.entries()]
    .sort((left, right) => right[1] - left[1])
    .slice(0, limit)
    .map(([word]) => word);
};

export const topSentences = (
  sentences: string[],
  titleKeywords: string[],
  limit = 5
) => {
  const tokens = tokenize(sentences.join(" "));
  const keywordWeights = new Map<string, number>();

  for (const token of tokens) {
    keywordWeights.set(token, (keywordWeights.get(token) ?? 0) + 1);
  }

  return sentences
    .map((sentence, index) => {
      const sentenceTokens = tokenize(sentence);
      const baseScore = sentenceTokens.reduce(
        (total, token) => total + (keywordWeights.get(token) ?? 0),
        0
      );
      const titleBoost = sentenceTokens.reduce(
        (total, token) => total + (titleKeywords.includes(token) ? 4 : 0),
        0
      );
      const positionBoost = index === 0 ? 8 : index < 3 ? 4 : 0;

      return {
        sentence,
        score: baseScore + titleBoost + positionBoost
      };
    })
    .sort((left, right) => right.score - left.score)
    .slice(0, limit)
    .map((item) => item.sentence);
};

export const stripListMarker = (value: string) =>
  value.replace(/^(([-*•])|(\d+[.)])|([a-z][.)]))\s+/i, "").trim();

export const isListItem = (value: string) =>
  /^(([-*•])|(\d+[.)])|([a-z][.)]))\s+/i.test(value.trim());

export const cleanHeading = (value: string) =>
  stripListMarker(value).replace(/[:\-–]\s*$/, "").trim();

export const isLikelyHeading = (value: string) => {
  const clean = cleanHeading(value);

  if (!clean || clean.length > 72) {
    return false;
  }

  if (/[.!?]$/.test(clean)) {
    return false;
  }

  const wordCount = clean.split(/\s+/).length;
  if (wordCount > 9) {
    return false;
  }

  const hasLetters = /[A-Za-z]/.test(clean);
  if (!hasLetters) {
    return false;
  }

  return (
    /^#{1,6}\s+/.test(value) ||
    /^[A-Z][A-Za-z0-9/&(),'\- ]+$/.test(clean) ||
    (clean === clean.toUpperCase() && clean.length >= 3) ||
    /:\s*$/.test(value.trim())
  );
};

export const sentenceForKeyword = (keyword: string, sentences: string[]) =>
  sentences.find((sentence) =>
    sentence.toLowerCase().includes(keyword.toLowerCase())
  );

export const compactText = (value: string, maxWords = 22) => {
  const words = normalizeWhitespace(value).split(/\s+/).filter(Boolean);
  if (words.length <= maxWords) {
    return words.join(" ");
  }

  return `${words.slice(0, maxWords).join(" ")}...`;
};

export const sharedTokenRatio = (left: string, right: string) => {
  const leftTokens = new Set(tokenize(left));
  const rightTokens = new Set(tokenize(right));

  if (!leftTokens.size || !rightTokens.size) {
    return 0;
  }

  let shared = 0;
  for (const token of leftTokens) {
    if (rightTokens.has(token)) {
      shared += 1;
    }
  }

  return shared / Math.max(leftTokens.size, rightTokens.size);
};

export const toTitleCase = (value: string) =>
  value.replace(/\b\w/g, (match) => match.toUpperCase());

export const clamp = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), max);
