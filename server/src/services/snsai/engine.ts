import crypto from "crypto";
import { chooseBestNativeVariant, getNativeModelName } from "../native-model";
import {
  Flashcard,
  KeyConcept,
  NarrationSegment,
  SectionInsight,
  StoryArtifact,
  StoryBeat,
  StoryCharacter,
  SummaryArtifact,
  SummaryFormat,
  SummaryMode,
  SummaryRecord
} from "../../types";
import {
  compactText,
  isLikelyHeading,
  isListItem,
  normalizeWhitespace,
  sentenceForKeyword,
  sharedTokenRatio,
  splitLines,
  splitParagraphs,
  splitSentences,
  stripListMarker,
  tokenize,
  toTitleCase,
  uniqueOrdered,
  estimateReadingTime
} from "./text";

const BASE_ENGINE_NAME = "SNSAI Deep Note Intelligence";

type NoteType = "process" | "system" | "comparison" | "concept" | "mixed";

interface DefinitionPattern {
  term: string;
  meaning: string;
  sentence: string;
}

interface RelationPattern {
  from: string;
  connector: string;
  to: string;
  sentence: string;
}

interface RawSection {
  title: string;
  lines: string[];
}

interface SectionAnalysis {
  title: string;
  rawText: string;
  sentences: string[];
  listItems: string[];
  keywords: string[];
  definitions: DefinitionPattern[];
  relations: RelationPattern[];
  steps: string[];
  examples: string[];
  anchorSentence: string;
  gist: string;
}

interface NoteAnalysis {
  topic: string;
  noteType: NoteType;
  sourceScope: "page" | "selection";
  sections: SectionAnalysis[];
  keywords: string[];
  titleKeywords: string[];
  definitions: DefinitionPattern[];
  relations: RelationPattern[];
  steps: string[];
  examples: string[];
  rankedSentences: string[];
  centralIdea: string;
}

interface ScoredConceptCandidate {
  term: string;
  score: number;
}

const toneLeadByMode: Record<SummaryMode, string[]> = {
  concise: ["Core idea:", "Main takeaway:", "Key link:"],
  easy: ["Easy view:", "Think of it like this:", "Simple takeaway:"],
  study: ["Study anchor:", "Remember this:", "Revision link:"],
  exam: ["Exam-ready:", "High-probability point:", "Answer structure:"],
  deep: ["Deep insight:", "Underlying pattern:", "Higher-order link:"],
  story: ["Story clue:", "Scene lesson:", "Narrative signal:"]
};

const noteTypeDescriptions: Record<NoteType, string> = {
  process: "a step-driven learning sequence",
  system: "an interconnected system of ideas",
  comparison: "a comparison between linked viewpoints or parts",
  concept: "a definition-heavy concept explanation",
  mixed: "a layered study note with multiple kinds of information"
};

const storyWorlds: Record<
  NoteType,
  Array<{ setting: string; frame: string; narrator: string }>
> = {
  process: [
    {
      setting: "the Clockwork Passage",
      frame: "each chamber unlocks only after the previous step is understood",
      narrator: "the workshop guide"
    },
    {
      setting: "the River of Sequence",
      frame: "the lesson moves forward like stations along a living current",
      narrator: "the river keeper"
    }
  ],
  system: [
    {
      setting: "the Living City of Ideas",
      frame: "every district depends on the others to keep the whole city functioning",
      narrator: "the city architect"
    },
    {
      setting: "the Signal Observatory",
      frame: "every tower sends meaning to another part of the system",
      narrator: "the observatory mentor"
    }
  ],
  comparison: [
    {
      setting: "the Bridge of Two Worlds",
      frame: "understanding grows by walking between parallel sides of the same lesson",
      narrator: "the bridge storyteller"
    },
    {
      setting: "the Hall of Mirrors",
      frame: "paired rooms reveal how similar ideas differ in purpose and effect",
      narrator: "the mirror guide"
    }
  ],
  concept: [
    {
      setting: "the Grand Library of Meaning",
      frame: "every shelf turns definitions into memorable insight",
      narrator: "the head librarian"
    },
    {
      setting: "the Memory Museum",
      frame: "every gallery turns a concept into a visual explanation",
      narrator: "the museum curator"
    }
  ],
  mixed: [
    {
      setting: "the Discovery Garden",
      frame: "paths, rooms, and landmarks combine into one guided lesson",
      narrator: "the garden narrator"
    },
    {
      setting: "the Learning Atlas",
      frame: "maps, machines, and pathways blend into a single explorable world",
      narrator: "the atlas guide"
    }
  ]
};

const storyNames = [
  "Mira",
  "Arin",
  "Leena",
  "Kai",
  "Sora",
  "Niva",
  "Tarin",
  "Ira"
];

const storyRoles = [
  "pathfinder",
  "archivist",
  "builder",
  "signal keeper",
  "translator"
];

const generatedSectionNames = [
  "Foundation",
  "Core Build",
  "Mechanism",
  "Connection",
  "Application",
  "Final Insight"
];

const genericPhraseTokens = new Set([
  "main",
  "key",
  "why",
  "it",
  "this",
  "that",
  "these",
  "those",
  "also",
  "part",
  "section",
  "sections",
  "stage",
  "stages",
  "core",
  "final",
  "important",
  "process",
  "overview",
  "study",
  "deep",
  "guide",
  "lesson",
  "far",
  "less",
  "page",
  "pages",
  "chapter",
  "unit",
  "module",
  "revision",
  "summary",
  "review",
  "intro",
  "introduction",
  "basics",
  "complete",
  "full",
  "entire",
  "whole",
  "matter",
  "matters",
  "notes",
  "note"
]);

const weakConceptVerbs = new Set([
  "change",
  "changes",
  "form",
  "forms",
  "make",
  "makes",
  "matter",
  "matters",
  "produce",
  "produces",
  "increase",
  "increases",
  "divide",
  "divides",
  "keep",
  "keeps",
  "support",
  "supports",
  "reduce",
  "reduces",
  "help",
  "helps",
  "use",
  "uses",
  "using",
  "used",
  "build",
  "builds",
  "store",
  "stores",
  "release",
  "releases",
  "released",
  "absorb",
  "absorbs",
  "maintain",
  "maintains",
  "provide",
  "provides",
  "move",
  "moves",
  "occur",
  "occurs",
  "convert",
  "converts",
  "power",
  "powers",
  "capture",
  "captures",
  "feed",
  "feeds",
  "shift",
  "shifts",
  "follow",
  "follows",
  "connect",
  "connects",
  "work",
  "works"
]);

const structuralConceptTokens = new Set([
  "to",
  "and",
  "or",
  "into",
  "through",
  "from",
  "with",
  "again"
]);

const formatGuideByFormat: Record<SummaryFormat, string> = {
  "smart-notes":
    "Smart Notes gives a direct summary first, then the structure, the main links, and the best things to remember.",
  bullets:
    "Bullets compress the note into fast, plain-language points that are easy to scan.",
  paragraph:
    "Paragraph mode turns the note into one smooth explanation you can read straight through.",
  flashcards:
    "Flashcards convert the note into question-and-answer prompts for active recall.",
  "concept-map":
    "Concept Map mode highlights how the note's ideas connect and influence each other.",
  storyboard:
    "Storyboard mode explains the note as a guided scene-by-scene lesson with story flow."
};

const voiceStyleByNoteType: Record<NoteType, string> = {
  process:
    "A warm teacher voice with smoother pacing, soft transitions, and patient emphasis on each step.",
  system:
    "A polished explainer voice with steady pacing, cleaner pauses, and brighter emphasis when ideas connect.",
  comparison:
    "A balanced storyteller voice that keeps contrasts clear while still sounding calm and elegant.",
  concept:
    "A calm mentor voice with clear articulation, softer energy, and careful emphasis on meaning.",
  mixed:
    "A smooth study voice that sounds gentle, organized, and slightly more expressive on key insights."
};

const storyLandmarksByNoteType: Record<NoteType, string[]> = {
  process: ["the first gate", "the turning wheel", "the bridge of order", "the final doorway"],
  system: ["the signal hall", "the central chamber", "the web of links", "the final control room"],
  comparison: ["the left corridor", "the right corridor", "the bridge between them", "the final mirror room"],
  concept: ["the first gallery", "the meaning room", "the memory shelf", "the final library arch"],
  mixed: ["the entry path", "the learning square", "the insight garden", "the final observatory"]
};

const storyOrdinalLabels = ["One", "Two", "Three", "Four", "Five"];

const topicDecoratorPattern =
  /\b(?:deep study|study notes?|study guide|revision notes?|revision guide|revision|summary|overview|lesson|guide|introduction|explained|explanation|notes?|page|pages|chapter|unit|module|worksheet|basics?|review)\b/gi;

const knownAcronyms = new Set([
  "atp",
  "adp",
  "dna",
  "rna",
  "nadp",
  "nadph",
  "co2",
  "o2",
  "h2o",
  "ph"
]);

const sentenceCueScore = (sentence: string) => {
  let score = 0;

  if (/\b(is|are|means|refers to|defined as)\b/i.test(sentence)) {
    score += 8;
  }

  if (/\b(because|therefore|thus|as a result|so that|leads to|results in|causes|depends on)\b/i.test(sentence)) {
    score += 7;
  }

  if (/\b(first|second|third|next|then|after that|finally|lastly)\b/i.test(sentence)) {
    score += 6;
  }

  if (/\b(for example|for instance|such as)\b/i.test(sentence)) {
    score += 3;
  }

  if (/\b(however|whereas|while|unlike|in contrast)\b/i.test(sentence)) {
    score += 4;
  }

  return score;
};

const cleanEnd = (value: string) =>
  value.replace(/\s+/g, " ").trim().replace(/[;,:-]+$/, "").replace(/\.+$/, "");

const ensureSentence = (value: string) => {
  const clean = cleanEnd(value);
  if (!clean) {
    return clean;
  }

  return /[.!?]$/.test(clean) ? clean : `${clean}.`;
};

const capitalizeFirst = (value: string) =>
  value ? `${value.charAt(0).toUpperCase()}${value.slice(1)}` : value;

const stripLeadingArticle = (value: string) =>
  value.replace(/^(?:the|a|an)\s+/i, "").trim();

const formatDisplayLabel = (value: string) =>
  normalizeWhitespace(value)
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => {
      if (/^[A-Z0-9-]{2,}$/.test(word)) {
        return word;
      }

      const lower = word.toLowerCase();
      if (knownAcronyms.has(lower)) {
        return lower.toUpperCase();
      }

      return capitalizeFirst(lower);
    })
    .join(" ");

const toSpeechFriendlyTerm = (value: string) =>
  value
    .replace(/\b([A-Z]{2,6})\b/g, (match) => match.split("").join(" "))
    .replace(/\bCO2\b/g, "C O 2")
    .replace(/\bO2\b/g, "O 2")
    .replace(/\bH2O\b/g, "H 2 O")
    .replace(/\//g, " or ")
    .replace(/&/g, " and ");

const toSpokenSentence = (value: string) =>
  ensureSentence(
    compactText(
      toSpeechFriendlyTerm(
        normalizeWhitespace(value)
          .replace(/\s*->\s*/g, " then ")
          .replace(/[:]/g, ",")
      ),
      34
    )
  );

const toSpokenQuestion = (value: string) => {
  const clean = cleanEnd(toSpeechFriendlyTerm(value)).replace(/\?+$/, "");
  return clean ? `${capitalizeFirst(clean)}?` : "";
};

const normalizeConceptTerm = (value: string) =>
  cleanEnd(value).toLowerCase().replace(/\s+/g, " ").trim();

const stripTopicDecorators = (value: string) =>
  normalizeWhitespace(
    value
      .replace(/\((?:study|overview|summary|revision|notes?|lesson|guide)[^)]*\)/gi, " ")
      .replace(topicDecoratorPattern, " ")
      .replace(/[-–|:]+/g, " ")
  );

const joinNaturalList = (values: string[]) => {
  const cleanValues = values.map((value) => cleanEnd(value)).filter(Boolean);

  if (cleanValues.length <= 1) {
    return cleanValues[0] ?? "";
  }

  if (cleanValues.length === 2) {
    return `${cleanValues[0]} and ${cleanValues[1]}`;
  }

  return `${cleanValues.slice(0, -1).join(", ")}, and ${cleanValues[cleanValues.length - 1]}`;
};

const isUsefulConceptTerm = (term: string) => {
  const words = cleanEnd(term).toLowerCase().split(/\s+/).filter(Boolean);

  if (!words.length || words.length > 4) {
    return false;
  }

  if (words.some((word) => genericPhraseTokens.has(word) || weakConceptVerbs.has(word))) {
    return false;
  }

  if (words.length > 1 && words.some((word) => structuralConceptTokens.has(word))) {
    return false;
  }

  return tokenize(words.join(" ")).length > 0;
};

const wordCount = (value: string) => cleanEnd(value).split(/\s+/).filter(Boolean).length;

const containsWholeWord = (target: string, token: string) =>
  new RegExp(`\\b${token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(target);

const occursInAnySentence = (term: string, sentences: string[]) =>
  sentences.some((sentence) => containsWholeWord(sentence.toLowerCase(), term.toLowerCase()));

const hasTopicOverlap = (term: string, analysis: NoteAnalysis) => {
  const termTokens = tokenize(term);
  return termTokens.some((token) => analysis.titleKeywords.includes(token));
};

const pickLeadDefinition = (analysis: NoteAnalysis) =>
  analysis.definitions.find((definition) => hasTopicOverlap(definition.term, analysis)) ??
  analysis.definitions[0];

const isCompactTeachingRelation = (relation?: RelationPattern) => {
  if (!relation) {
    return false;
  }

  return isUsefulConceptTerm(relation.from) && isUsefulConceptTerm(relation.to);
};

const buildTeachingAnchor = (analysis: NoteAnalysis) => {
  const definition = pickLeadDefinition(analysis);
  const relation = analysis.relations.find((item) => isCompactTeachingRelation(item));
  const stepLabels = buildSequenceLabels(analysis.steps).slice(0, 4);

  switch (analysis.noteType) {
    case "process":
      if (stepLabels.length >= 2) {
        return `This note explains ${analysis.topic} as a process that moves through ${joinNaturalList(stepLabels.slice(0, 3))}`;
      }
      break;
    case "system":
      if (relation) {
        return `This note explains ${analysis.topic} as a connected system where ${relation.from} ${relation.connector} ${relation.to}`;
      }
      break;
    case "comparison":
      if (analysis.sections.length >= 2) {
        return `This note explains ${analysis.topic} by comparing ${analysis.sections[0].title} and ${analysis.sections[1].title}`;
      }
      break;
    case "concept":
      if (definition) {
        return `This note explains ${analysis.topic} as ${cleanEnd(definition.meaning)}`;
      }
      break;
    default:
      break;
  }

  if (definition && relation) {
    return `This note explains ${analysis.topic} as ${cleanEnd(definition.meaning)}, and it shows how ${relation.from} ${relation.connector} ${relation.to}`;
  }

  if (definition) {
    return `This note explains ${analysis.topic} as ${cleanEnd(definition.meaning)}`;
  }

  if (relation) {
    return `${analysis.topic} becomes clearer when you see how ${relation.from} ${relation.connector} ${relation.to}`;
  }

  return cleanEnd(analysis.centralIdea);
};

const buildStandaloneTopicExplanation = (analysis: NoteAnalysis) => {
  const definition = pickLeadDefinition(analysis);
  const compactRelation = analysis.relations.find((relation) => isCompactTeachingRelation(relation));
  const stepLabels = buildSequenceLabels(analysis.steps);

  if (definition) {
    return `${analysis.topic} is ${cleanEnd(definition.meaning)}`;
  }

  if (stepLabels.length >= 2) {
    return `${analysis.topic} works through ${joinNaturalList(stepLabels.slice(0, 3))}`;
  }

  if (compactRelation) {
    return `In ${analysis.topic}, ${compactRelation.from} ${compactRelation.connector} ${compactRelation.to}`;
  }

  return buildTeachingAnchor(analysis);
};

const buildImportanceLine = (
  analysis: NoteAnalysis,
  sectionInsights: SectionInsight[]
) =>
  sectionInsights.find((section) =>
    /\b(why|importance|benefit|matters|effect|result|outcome|impact|purpose|use)\b/i.test(
      section.title
    )
  )?.gist ??
  analysis.examples[0] ??
  sectionInsights[2]?.gist ??
  "";

const buildMechanismLine = (
  analysis: NoteAnalysis,
  relationships: string[]
) => {
  const stepLabels = buildSequenceLabels(analysis.steps);

  if (stepLabels.length >= 2) {
    return `The main sequence is ${joinNaturalList(stepLabels.slice(0, 3))}.`;
  }

  const compactRelation = analysis.relations.find((item) => isCompactTeachingRelation(item));
  if (compactRelation) {
    return `${compactRelation.from} ${compactRelation.connector} ${compactRelation.to}.`;
  }

  if (relationships[0]) {
    return `${relationships[0].replace(/ -> /g, " ")}.`;
  }

  return "";
};

const stableIndex = (seed: string, length: number) => {
  const numeric = Number.parseInt(
    crypto.createHash("sha256").update(seed).digest("hex").slice(0, 8),
    16
  );
  return numeric % length;
};

const stablePick = <T>(seed: string, values: T[]) =>
  values[stableIndex(seed, values.length)];

const looksReasonableTerm = (value: string) => {
  const clean = cleanEnd(value);
  const words = clean.split(/\s+/).filter(Boolean);
  if (!clean || words.length === 0 || words.length > 6 || clean.length > 48) {
    return false;
  }

  return tokenize(clean).length > 0;
};

const extractAnchorLabel = (value: string) => {
  const cleanedSentence = normalizeWhitespace(stripListMarker(value))
    .replace(
      /^(?:first|second|third|next|then|finally|lastly|after that|in this stage|in this step)\s+/i,
      ""
    )
    .trim();

  if (!cleanedSentence) {
    return "";
  }

  const patterns = [
    /^(?<label>[^,.]{2,60}?)\s+(?:is|are|means|refers to|can be defined as|is defined as)\b/i,
    /^(?<label>[^,.]{2,60}?)\s+(?:occurs|happens|converts|powers|provides|releases|captures|uses|drives|supports|creates|stores|moves|transports|feeds|controls|shifts|begins|starts|ends)\b/i
  ];

  let candidate = "";

  for (const pattern of patterns) {
    const match = cleanedSentence.match(pattern);
    if (match?.groups?.label) {
      candidate = match.groups.label.trim();
      break;
    }
  }

  if (!candidate && wordCount(cleanedSentence) <= 4) {
    candidate = cleanedSentence;
  }

  candidate = stripLeadingArticle(
    candidate
      .replace(/\b(?:because|which|that)\b.*$/i, "")
      .replace(/^(?:this part|this stage|this step|the note|the lesson|the story)\s+/i, "")
      .trim()
  );

  if (/^(?:when|if|while|because|after|before|during)\b/i.test(candidate)) {
    return "";
  }

  if (!candidate || !looksReasonableTerm(candidate) || !isUsefulConceptTerm(candidate)) {
    return "";
  }

  return formatDisplayLabel(candidate);
};

const buildSequenceLabels = (steps: string[]) => {
  const anchorLabels = uniqueOrdered(steps.map(extractAnchorLabel).filter(Boolean));

  if (anchorLabels.length >= Math.min(steps.length, 2)) {
    return anchorLabels.slice(0, 4);
  }

  return uniqueOrdered(
    steps
      .map((step) => compactText(stripListMarker(step), 6))
      .filter(Boolean)
      .map(formatDisplayLabel)
  ).slice(0, 4);
};

const isStrongSectionAnchor = (anchor: string, section: SectionAnalysis) => {
  if (wordCount(anchor) > 1 || /^[A-Z0-9-]{2,}$/.test(anchor)) {
    return true;
  }

  const normalized = normalizeConceptTerm(anchor);

  return (
    section.definitions.some(
      (definition) => normalizeConceptTerm(definition.term) === normalized
    ) ||
    buildSequenceLabels(section.steps).some(
      (stepLabel) => normalizeConceptTerm(stepLabel) === normalized
    )
  );
};

const deriveTopic = (
  title: string,
  definitions: DefinitionPattern[],
  keywords: string[]
) => {
  const cleanedTitle = stripLeadingArticle(stripTopicDecorators(title)).trim();
  const cleanedTitleTokens = tokenize(cleanedTitle);
  const titleBag = new Set(cleanedTitleTokens);
  const matchingDefinition =
    definitions.find((definition) => {
      const definitionTokens = tokenize(definition.term);
      return definitionTokens.length > 0 && definitionTokens.every((token) => titleBag.has(token));
    }) ??
    definitions.find((definition) => sharedTokenRatio(cleanedTitle, definition.term) > 0.45);

  if (matchingDefinition) {
    return formatDisplayLabel(matchingDefinition.term);
  }

  if (cleanedTitle && cleanedTitleTokens.length) {
    return formatDisplayLabel(cleanedTitle);
  }

  if (definitions[0]) {
    return formatDisplayLabel(definitions[0].term);
  }

  return formatDisplayLabel(keywords[0] ?? "Your Note");
};

const getStorySectionTitle = (
  title: string,
  analysis: NoteAnalysis,
  index: number
) => {
  const cleanTitle = cleanEnd(title);

  if (
    index === 0 &&
    (sharedTokenRatio(cleanTitle, analysis.topic) >= 0.45 ||
      normalizeConceptTerm(cleanTitle) === normalizeConceptTerm(analysis.topic))
  ) {
    return "Core Idea";
  }

  if (/^definition$/i.test(cleanTitle)) {
    return "Core Meaning";
  }

  if (/\b(stage|stages|step|steps|sequence|mechanism|process)\b/i.test(cleanTitle)) {
    return "How It Works";
  }

  if (/\b(why|importance|benefit|purpose|use|uses|matters|impact)\b/i.test(cleanTitle)) {
    return "Why It Matters";
  }

  if (/\b(connection|link|relationship|integration|summary|big picture)\b/i.test(cleanTitle)) {
    return "Big Picture";
  }

  return cleanTitle;
};

const getStoryChapterLabel = (index: number, total: number) => {
  if (index === 0) {
    return "Opening";
  }

  if (index === total - 1) {
    return "Final Chapter";
  }

  return `Chapter ${storyOrdinalLabels[Math.min(index - 1, storyOrdinalLabels.length - 1)]}`;
};

const distinctTeachingLines = (values: string[]) => {
  const chosen: string[] = [];

  for (const value of values) {
    const clean = normalizeWhitespace(value);
    if (!clean) {
      continue;
    }

    if (chosen.some((existing) => sharedTokenRatio(existing, clean) >= 0.72)) {
      continue;
    }

    chosen.push(clean);
  }

  return chosen;
};

const dedupeDefinitions = (definitions: DefinitionPattern[]) =>
  uniqueOrdered(
    definitions.map((definition) => JSON.stringify(definition))
  ).map((item) => JSON.parse(item) as DefinitionPattern);

const dedupeRelations = (relations: RelationPattern[]) =>
  uniqueOrdered(relations.map((relation) => JSON.stringify(relation))).map(
    (item) => JSON.parse(item) as RelationPattern
  );

const extractDefinitions = (sentences: string[]): DefinitionPattern[] => {
  const patterns = [
    /^(?<term>[^.]{2,60}?)\s+(?:is|are)\s+(?<meaning>(?:a|an|the)\s+[^.]{4,220})$/i,
    /^(?<term>[^.]{2,60}?)\s+(?:refers to|means|is defined as|can be defined as)\s+(?<meaning>[^.]{6,220})$/i
  ];

  const definitions: DefinitionPattern[] = [];

  for (const sentence of sentences) {
    const cleanSentence = cleanEnd(sentence);

    for (const pattern of patterns) {
      const match = cleanSentence.match(pattern);
      const term = match?.groups?.term?.trim();
      const meaning = match?.groups?.meaning?.trim();

      if (!term || !meaning || !looksReasonableTerm(term)) {
        continue;
      }

      definitions.push({
        term,
        meaning: compactText(ensureSentence(meaning), 28),
        sentence: ensureSentence(cleanSentence)
      });
      break;
    }
  }

  return dedupeDefinitions(definitions);
};

const normalizeRelationPart = (value: string) => compactText(cleanEnd(value), 12);

const extractRelations = (sentences: string[]): RelationPattern[] => {
  const relations: RelationPattern[] = [];

  const directPattern =
    /^(?<from>[^.]{2,90}?)\s+(?<connector>causes|creates|produces|leads to|results in|drives|shapes|supports|enables|improves|reduces|depends on|connects to|influences)\s+(?<to>[^.]{2,110})$/i;
  const becausePattern = /^(?<from>[^.]{2,90}?)\s+because\s+(?<to>[^.]{2,110})$/i;
  const ifThenPattern = /^if\s+(?<from>[^,]{2,90}),\s*then\s+(?<to>[^.]{2,110})$/i;

  for (const sentence of sentences) {
    const cleanSentence = cleanEnd(sentence);
    let match = cleanSentence.match(directPattern);

    if (
      match?.groups &&
      (!cleanSentence.includes(",") ||
        /\b(causes|leads to|results in|depends on)\b/i.test(cleanSentence))
    ) {
      relations.push({
        from: normalizeRelationPart(match.groups.from),
        connector: match.groups.connector.toLowerCase(),
        to: normalizeRelationPart(match.groups.to),
        sentence: ensureSentence(cleanSentence)
      });
      continue;
    }

    match = cleanSentence.match(becausePattern);
    if (match?.groups) {
      relations.push({
        from: normalizeRelationPart(match.groups.from),
        connector: "depends on",
        to: normalizeRelationPart(match.groups.to),
        sentence: ensureSentence(cleanSentence)
      });
      continue;
    }

    match = cleanSentence.match(ifThenPattern);
    if (match?.groups) {
      relations.push({
        from: normalizeRelationPart(match.groups.from),
        connector: "leads to",
        to: normalizeRelationPart(match.groups.to),
        sentence: ensureSentence(cleanSentence)
      });
    }
  }

  return dedupeRelations(
    relations.filter(
      (relation) => relation.from.length > 2 && relation.to.length > 2
    )
  );
};

const extractExamples = (sentences: string[]) =>
  sentences
    .filter((sentence) =>
      /\b(for example|for instance|such as|including)\b/i.test(sentence)
    )
    .map((sentence) => ensureSentence(compactText(sentence, 24)))
    .slice(0, 4);

const extractSteps = (listItems: string[], sentences: string[]) => {
  const orderedList = listItems
    .map((item) => compactText(stripListMarker(item), 14))
    .filter(Boolean);

  if (orderedList.length >= 2) {
    return uniqueOrdered(orderedList).slice(0, 6);
  }

  const cueSentences = sentences
    .filter((sentence) =>
      /\b(first|second|third|next|then|after that|finally|lastly)\b/i.test(sentence)
    )
    .map((sentence) => compactText(sentence, 16));

  return uniqueOrdered(cueSentences).slice(0, 6);
};

const buildSections = (text: string, topic: string): RawSection[] => {
  const lines = splitLines(text);
  const sections: RawSection[] = [];
  let current: RawSection = { title: topic || "Core Notes", lines: [] };

  const flush = () => {
    const content = current.lines.filter(Boolean);
    if (!content.length) {
      return;
    }

    sections.push({
      title: current.title || topic || "Core Notes",
      lines: content
    });
  };

  for (const line of lines) {
    if (!line) {
      continue;
    }

    const headingCandidate = !isListItem(line) && isLikelyHeading(line);
    if (headingCandidate) {
      flush();
      current = {
        title: cleanEnd(stripListMarker(line)),
        lines: []
      };
      continue;
    }

    current.lines.push(line);
  }

  flush();

  if (sections.length <= 1) {
    const paragraphs = splitParagraphs(text);
    if (paragraphs.length > 1) {
      return paragraphs.map((paragraph, index) => {
        const keywords = tokenize(paragraph).slice(0, 3).map(toTitleCase);
        const generated =
          keywords.length > 0
            ? `${generatedSectionNames[index % generatedSectionNames.length]}: ${keywords.join(" ")}`
            : generatedSectionNames[index % generatedSectionNames.length];

        return {
          title: generated,
          lines: [paragraph]
        };
      });
    }
  }

  return sections;
};

const selectCoverageSentences = (
  sentences: string[],
  titleKeywords: string[],
  focusKeywords: string[],
  limit: number
) => {
  const weights = new Map<string, number>();
  const allTokens = tokenize(sentences.join(" "));

  for (const token of allTokens) {
    weights.set(token, (weights.get(token) ?? 0) + 1);
  }

  const candidates = sentences.map((sentence, index) => {
    const sentenceTokens = tokenize(sentence);
    const keywordScore = sentenceTokens.reduce(
      (total, token) => total + (weights.get(token) ?? 0),
      0
    );
    const titleBoost = sentenceTokens.reduce(
      (total, token) => total + (titleKeywords.includes(token) ? 4 : 0),
      0
    );
    const focusBoost = sentenceTokens.reduce(
      (total, token) => total + (focusKeywords.includes(token) ? 2 : 0),
      0
    );
    const lengthBoost =
      sentenceTokens.length >= 7 && sentenceTokens.length <= 28 ? 4 : 1;
    const positionBoost = index === 0 ? 5 : index < 3 ? 2 : 0;

    return {
      sentence: ensureSentence(sentence),
      score:
        keywordScore +
        titleBoost +
        focusBoost +
        lengthBoost +
        positionBoost +
        sentenceCueScore(sentence)
    };
  });

  const chosen: string[] = [];

  while (chosen.length < limit && candidates.length) {
    let bestIndex = 0;
    let bestScore = -Infinity;

    for (let index = 0; index < candidates.length; index += 1) {
      const candidate = candidates[index];
      const overlapPenalty = chosen.reduce(
        (total, selected) => total + sharedTokenRatio(selected, candidate.sentence) * 8,
        0
      );
      const effectiveScore = candidate.score - overlapPenalty;

      if (effectiveScore > bestScore) {
        bestScore = effectiveScore;
        bestIndex = index;
      }
    }

    chosen.push(candidates[bestIndex].sentence);
    candidates.splice(bestIndex, 1);
  }

  return chosen;
};

const buildSectionGist = (section: Omit<SectionAnalysis, "gist">) => {
  if (section.definitions[0]) {
    return ensureSentence(
      `${toTitleCase(section.definitions[0].term)} means ${cleanEnd(section.definitions[0].meaning)}`
    );
  }

  const compactRelation = section.relations.find((relation) => isCompactTeachingRelation(relation));
  if (compactRelation) {
    return ensureSentence(
      `${compactRelation.from} ${compactRelation.connector} ${compactRelation.to}`
    );
  }

  if (section.steps.length >= 2) {
    return ensureSentence(
      `This part moves from ${section.steps[0]} to ${section.steps[1]}${section.steps[2] ? ` and then ${section.steps[2]}` : ""}`
    );
  }

  if (section.anchorSentence) {
    return ensureSentence(compactText(section.anchorSentence, 24));
  }

  return ensureSentence(compactText(section.rawText, 24));
};

const analyzeSection = (
  section: RawSection,
  titleKeywords: string[]
): SectionAnalysis => {
  const listItems = section.lines.filter(isListItem).map(stripListMarker);
  const textBody = section.lines.map(stripListMarker).join(" ");
  const baseSentences = splitSentences(textBody);
  const listSentences = listItems.map((item) => ensureSentence(item));
  const sentencePool = uniqueOrdered(
    [...baseSentences, ...listSentences].map((item) => ensureSentence(item)).filter(Boolean)
  );
  const keywords = uniqueOrdered(tokenize(`${section.title} ${textBody}`)).slice(0, 6);
  const definitions = extractDefinitions(sentencePool);
  const relations = extractRelations(sentencePool);
  const steps = extractSteps(listItems, sentencePool);
  const examples = extractExamples(sentencePool);
  const anchorSentence =
    selectCoverageSentences(sentencePool, titleKeywords, keywords, 1)[0] ?? "";

  const baseSection: Omit<SectionAnalysis, "gist"> = {
    title: section.title,
    rawText: textBody,
    sentences: sentencePool,
    listItems,
    keywords,
    definitions,
    relations,
    steps,
    examples,
    anchorSentence
  };

  return {
    ...baseSection,
    gist: buildSectionGist(baseSection)
  };
};

const determineNoteType = (analysis: {
  definitions: DefinitionPattern[];
  relations: RelationPattern[];
  steps: string[];
  rankedSentences: string[];
}) => {
  const joined = analysis.rankedSentences.join(" ");

  if (analysis.steps.length >= 3) {
    return "process";
  }

  if (/\b(whereas|however|in contrast|unlike|while)\b/i.test(joined)) {
    return "comparison";
  }

  if (analysis.relations.filter((relation) => isCompactTeachingRelation(relation)).length >= 2) {
    return "system";
  }

  if (analysis.definitions.length >= 2) {
    return "concept";
  }

  return "mixed";
};

const explainCentralIdea = (analysis: {
  topic: string;
  definitions: DefinitionPattern[];
  relations: RelationPattern[];
  rankedSentences: string[];
}) => {
  if (analysis.definitions[0]) {
    return ensureSentence(
      `${toTitleCase(analysis.definitions[0].term)} means ${cleanEnd(analysis.definitions[0].meaning)}`
    );
  }

  const compactRelation = analysis.relations.find((relation) => isCompactTeachingRelation(relation));
  if (compactRelation) {
    return ensureSentence(
      `${compactRelation.from} ${compactRelation.connector} ${compactRelation.to}`
    );
  }

  return analysis.rankedSentences[0] ?? ensureSentence(`The note centers on ${analysis.topic}`);
};

const analyzeNote = (input: {
  title: string;
  sourceText: string;
  sourceScope: "page" | "selection";
}): NoteAnalysis => {
  const titleKeywords = tokenize(input.title);
  const sections = buildSections(input.sourceText, input.title.trim() || "Core Notes").map(
    (section) => analyzeSection(section, titleKeywords)
  );
  const allSentences = uniqueOrdered(sections.flatMap((section) => section.sentences));

  const keywordMap = new Map<string, { count: number; sections: Set<number> }>();
  sections.forEach((section, index) => {
    const tokens = tokenize(`${section.title} ${section.rawText}`);
    for (const token of tokens) {
      const existing = keywordMap.get(token) ?? { count: 0, sections: new Set<number>() };
      existing.count += 1;
      existing.sections.add(index);
      keywordMap.set(token, existing);
    }
  });

  const keywords = [...keywordMap.entries()]
    .sort((left, right) => {
      const leftSpread = left[1].sections.size;
      const rightSpread = right[1].sections.size;
      return rightSpread - leftSpread || right[1].count - left[1].count;
    })
    .slice(0, 8)
    .map(([token]) => token);

  const definitions = dedupeDefinitions(sections.flatMap((section) => section.definitions));
  const relations = dedupeRelations(sections.flatMap((section) => section.relations));
  const steps = uniqueOrdered(sections.flatMap((section) => section.steps)).slice(0, 6);
  const examples = uniqueOrdered(sections.flatMap((section) => section.examples)).slice(0, 4);
  const rankedSentences = selectCoverageSentences(
    allSentences,
    titleKeywords,
    keywords,
    Math.min(6, Math.max(3, allSentences.length))
  );
  const noteType = determineNoteType({
    definitions,
    relations,
    steps,
    rankedSentences
  });
  const topic = deriveTopic(input.title.trim(), definitions, keywords);

  return {
    topic,
    noteType,
    sourceScope: input.sourceScope,
    sections,
    keywords,
    titleKeywords,
    definitions,
    relations,
    steps,
    examples,
    rankedSentences,
    centralIdea: explainCentralIdea({
      topic,
      definitions,
      relations,
      rankedSentences
    })
  };
};

const makeOverview = (mode: SummaryMode, analysis: NoteAnalysis) => {
  const teachingAnchor = buildTeachingAnchor(analysis);
  const standaloneExplanation = buildStandaloneTopicExplanation(analysis);
  const sectionFlow =
    analysis.sections.length > 1
      ? analysis.sections
          .slice(0, 4)
          .map((section, index) => getStorySectionTitle(section.title, analysis, index))
          .join(" -> ")
      : analysis.sections[0]?.title ?? analysis.topic;
  const themeText =
    analysis.keywords.slice(0, 4).map(toTitleCase).join(", ") || analysis.topic;

  switch (mode) {
    case "concise":
      return chooseBestNativeVariant({
        topic: analysis.topic,
        fallback: `This note is mainly about ${analysis.topic}. At the center is ${cleanEnd(teachingAnchor)}. It reads as ${noteTypeDescriptions[analysis.noteType]} and moves through ${sectionFlow}.`,
        variants: [
          `This note is mainly about ${analysis.topic}. At the center is ${cleanEnd(teachingAnchor)}. It reads as ${noteTypeDescriptions[analysis.noteType]} and moves through ${sectionFlow}.`,
          `${analysis.topic} is the core focus here. The note presents it as ${noteTypeDescriptions[analysis.noteType]} and moves through ${sectionFlow}.`,
          `The note centers on ${cleanEnd(standaloneExplanation)}. Its structure follows ${sectionFlow}.`
        ]
      });
    case "easy":
      return chooseBestNativeVariant({
        topic: analysis.topic,
        fallback: `In simple language, ${cleanEnd(standaloneExplanation)}. The note becomes easier if you follow ${sectionFlow} and keep these themes in mind: ${themeText}.`,
        variants: [
          `In simple language, ${cleanEnd(standaloneExplanation)}. The note becomes easier if you follow ${sectionFlow} and keep these themes in mind: ${themeText}.`,
          `${cleanEnd(standaloneExplanation)}. The easiest way to follow the lesson is to move through ${sectionFlow}.`,
          `Think of it this way: ${cleanEnd(standaloneExplanation)}. The main themes are ${themeText}.`
        ]
      });
    case "study":
      return chooseBestNativeVariant({
        topic: analysis.topic,
        fallback: `Study ${analysis.topic} as ${noteTypeDescriptions[analysis.noteType]}. Start with ${cleanEnd(teachingAnchor)}, then move through ${sectionFlow} so the whole lesson stays connected.`,
        variants: [
          `Study ${analysis.topic} as ${noteTypeDescriptions[analysis.noteType]}. Start with ${cleanEnd(teachingAnchor)}, then move through ${sectionFlow} so the whole lesson stays connected.`,
          `For revision, start with ${cleanEnd(standaloneExplanation)}. Then follow ${sectionFlow} to keep the lesson linked together.`,
          `Study ${analysis.topic} by first locking the main idea, then walking through ${sectionFlow}.`
        ]
      });
    case "exam":
      return chooseBestNativeVariant({
        topic: analysis.topic,
        fallback: `For exam answers, lock in this core statement first: ${cleanEnd(teachingAnchor)}. Then organize the explanation through ${sectionFlow} and use ${themeText} as your recall anchors.`,
        variants: [
          `For exam answers, lock in this core statement first: ${cleanEnd(teachingAnchor)}. Then organize the explanation through ${sectionFlow} and use ${themeText} as your recall anchors.`,
          `For an exam-ready answer, begin with ${cleanEnd(standaloneExplanation)}. Then explain it in the order of ${sectionFlow}.`,
          `In a test, state the main idea first, then build the answer through ${sectionFlow}.`
        ]
      });
    case "deep":
      return chooseBestNativeVariant({
        topic: analysis.topic,
        fallback: `At a deeper level, the note presents ${analysis.topic} as ${noteTypeDescriptions[analysis.noteType]}. The strongest underlying idea is ${cleanEnd(teachingAnchor)}, supported by themes such as ${themeText}.`,
        variants: [
          `At a deeper level, the note presents ${analysis.topic} as ${noteTypeDescriptions[analysis.noteType]}. The strongest underlying idea is ${cleanEnd(teachingAnchor)}, supported by themes such as ${themeText}.`,
          `At its deeper layer, ${analysis.topic} works as ${noteTypeDescriptions[analysis.noteType]}. The core logic is ${cleanEnd(standaloneExplanation)}.`,
          `${analysis.topic} becomes deeper when you connect the central idea to themes like ${themeText}.`
        ]
      });
    case "story":
      return chooseBestNativeVariant({
        topic: analysis.topic,
        fallback: `These ${analysis.sourceScope === "selection" ? "selected notes" : "notes"} form a teachable story about ${analysis.topic}. The central lesson is ${cleanEnd(teachingAnchor)}, and the narrative unfolds through ${sectionFlow}.`,
        variants: [
          `These ${analysis.sourceScope === "selection" ? "selected notes" : "notes"} form a teachable story about ${analysis.topic}. The central lesson is ${cleanEnd(teachingAnchor)}, and the narrative unfolds through ${sectionFlow}.`,
          `SNSAI turns ${analysis.topic} into a guided story lesson whose central idea is ${cleanEnd(standaloneExplanation)}.`,
          `The story version teaches ${analysis.topic} by moving through ${sectionFlow} while keeping the main lesson clear.`
        ]
      });
  }
};

const makeSectionInsights = (analysis: NoteAnalysis): SectionInsight[] =>
  analysis.sections.slice(0, 5).map((section) => {
    const titleTokens = new Set(tokenize(section.title));
    const relationConcepts = section.relations.flatMap((relation) =>
      [relation.from, relation.to].map(extractAnchorLabel).filter(Boolean)
    );
    const stepAnchors = section.steps.map(extractAnchorLabel).filter(Boolean);
    const listAnchors = section.listItems.map(extractAnchorLabel).filter(Boolean);
    const sentenceAnchors = section.sentences.map(extractAnchorLabel).filter(Boolean);
    const fallbackKeywords = section.keywords
      .filter(
        (item) =>
          !titleTokens.has(item) &&
          item.length > 3 &&
          !genericPhraseTokens.has(item.toLowerCase())
      )
      .map((item) => formatDisplayLabel(item));
    const anchors = uniqueOrdered(
      [
        ...section.definitions.slice(0, 2).map((definition) => formatDisplayLabel(definition.term)),
        ...stepAnchors,
        ...relationConcepts,
        ...listAnchors,
        ...sentenceAnchors,
        ...fallbackKeywords
      ].filter(Boolean)
    )
      .filter((anchor) => isStrongSectionAnchor(anchor, section))
      .slice(0, 4);

    return {
      title: section.title,
      gist: section.gist,
      focusPoints: anchors.length ? anchors : [compactText(section.gist, 8)]
    };
  });

const makeQuickTakeaways = (
  analysis: NoteAnalysis,
  sectionInsights: SectionInsight[],
  relationships: string[]
): string[] => {
  const standaloneExplanation = ensureSentence(buildStandaloneTopicExplanation(analysis));
  const sequenceLine = buildMechanismLine(analysis, relationships);
  const whyLine = buildImportanceLine(analysis, sectionInsights);
  const exampleLine = analysis.examples[0]
    ? `A useful example from the note is ${cleanEnd(analysis.examples[0])}.`
    : "";

  return distinctTeachingLines(
    [
      standaloneExplanation,
      sectionInsights[0]?.gist,
      sectionInsights[1]?.gist,
      sequenceLine,
      whyLine,
      exampleLine
    ].filter((value): value is string => Boolean(value))
  )
    .map((value) =>
      chooseBestNativeVariant({
        topic: analysis.topic,
        fallback: value,
        variants: [value, value.replace(/^This note explains\s+/i, ""), value.replace(/^In simple language,\s+/i, "")]
      })
    )
    .slice(0, 5);
};

const makeDirectSummary = (
  mode: SummaryMode,
  analysis: NoteAnalysis,
  sectionInsights: SectionInsight[],
  relationships: string[]
) => {
  const standaloneExplanation = buildStandaloneTopicExplanation(analysis);
  const sectionsLine =
    sectionInsights.length > 1
      ? `It mainly moves through ${joinNaturalList(
          sectionInsights
            .slice(0, 3)
            .map((section, index) => getStorySectionTitle(section.title, analysis, index))
        )}.`
      : "";
  const mechanismLine = buildMechanismLine(analysis, relationships);
  const importanceLine = buildImportanceLine(analysis, sectionInsights);

  switch (mode) {
    case "concise":
      return chooseBestNativeVariant({
        topic: analysis.topic,
        fallback: [`In one line: ${cleanEnd(standaloneExplanation)}.`, mechanismLine].filter(Boolean).join(" "),
        variants: [
          [`In one line: ${cleanEnd(standaloneExplanation)}.`, mechanismLine].filter(Boolean).join(" "),
          [`Main idea: ${cleanEnd(standaloneExplanation)}.`, mechanismLine].filter(Boolean).join(" "),
          `${cleanEnd(standaloneExplanation)}.`
        ]
      });
    case "easy":
      return chooseBestNativeVariant({
        topic: analysis.topic,
        fallback: [`Simply put, ${cleanEnd(standaloneExplanation)}.`, mechanismLine, importanceLine].filter(Boolean).join(" "),
        variants: [
          [`Simply put, ${cleanEnd(standaloneExplanation)}.`, mechanismLine, importanceLine].filter(Boolean).join(" "),
          [`In easy words, ${cleanEnd(standaloneExplanation)}.`, importanceLine].filter(Boolean).join(" "),
          `${cleanEnd(standaloneExplanation)}.`
        ]
      });
    case "study":
      return chooseBestNativeVariant({
        topic: analysis.topic,
        fallback: [`Study it this way: ${cleanEnd(standaloneExplanation)}.`, sectionsLine, mechanismLine].filter(Boolean).join(" "),
        variants: [
          [`Study it this way: ${cleanEnd(standaloneExplanation)}.`, sectionsLine, mechanismLine].filter(Boolean).join(" "),
          [`For study, remember this: ${cleanEnd(standaloneExplanation)}.`, sectionsLine].filter(Boolean).join(" "),
          `${cleanEnd(standaloneExplanation)}.`
        ]
      });
    case "exam":
      return chooseBestNativeVariant({
        topic: analysis.topic,
        fallback: [`A direct exam-ready answer is: ${cleanEnd(standaloneExplanation)}.`, mechanismLine, importanceLine].filter(Boolean).join(" "),
        variants: [
          [`A direct exam-ready answer is: ${cleanEnd(standaloneExplanation)}.`, mechanismLine, importanceLine].filter(Boolean).join(" "),
          [`Exam view: ${cleanEnd(standaloneExplanation)}.`, mechanismLine].filter(Boolean).join(" "),
          `${cleanEnd(standaloneExplanation)}.`
        ]
      });
    case "deep":
      return chooseBestNativeVariant({
        topic: analysis.topic,
        fallback: [`At its core, ${cleanEnd(standaloneExplanation)}.`, sectionsLine, importanceLine].filter(Boolean).join(" "),
        variants: [
          [`At its core, ${cleanEnd(standaloneExplanation)}.`, sectionsLine, importanceLine].filter(Boolean).join(" "),
          [`Deep view: ${cleanEnd(standaloneExplanation)}.`, sectionsLine].filter(Boolean).join(" "),
          `${cleanEnd(standaloneExplanation)}.`
        ]
      });
    case "story":
      return chooseBestNativeVariant({
        topic: analysis.topic,
        fallback: [`Before the story begins, remember this plainly: ${cleanEnd(standaloneExplanation)}.`, mechanismLine, importanceLine].filter(Boolean).join(" "),
        variants: [
          [`Before the story begins, remember this plainly: ${cleanEnd(standaloneExplanation)}.`, mechanismLine, importanceLine].filter(Boolean).join(" "),
          [`Story anchor: ${cleanEnd(standaloneExplanation)}.`, mechanismLine].filter(Boolean).join(" "),
          `${cleanEnd(standaloneExplanation)}.`
        ]
      });
  }
};

const makeFormatGuide = (format: SummaryFormat, mode: SummaryMode) => {
  const modeLine: Record<SummaryMode, string> = {
    concise: "This version is trimmed for the fastest possible understanding.",
    easy: "This version favors simple language and immediate clarity.",
    study: "This version is organized for revision and memory.",
    exam: "This version is shaped to help answer questions directly.",
    deep: "This version keeps the deeper logic and hidden links visible.",
    story: "This version teaches through narrative flow while preserving the lesson."
  };

  return `${formatGuideByFormat[format]} ${modeLine[mode]}`;
};

const adaptPointForMode = (mode: SummaryMode, point: string, index: number) => {
  const leads = toneLeadByMode[mode];
  const lead = leads[index % leads.length];
  return `${lead} ${cleanEnd(point)}.`;
};

const makeBullets = (mode: SummaryMode, quickTakeaways: string[]) =>
  uniqueOrdered(quickTakeaways)
    .slice(0, mode === "concise" ? 3 : 5)
    .map((point, index) => adaptPointForMode(mode, point, index));

const memoryHookForConcept = (term: string, explanation: string, noteType: NoteType) => {
  const metaphorByNoteType: Record<NoteType, string> = {
    process: "checkpoint in the learning journey",
    system: "control room that influences the whole system",
    comparison: "marker on the bridge between two ideas",
    concept: "main label on the memory shelf",
    mixed: "anchor point that keeps the lesson from drifting"
  };

  return `Remember ${toTitleCase(term)} as the ${metaphorByNoteType[noteType]}: ${compactText(explanation, 14)}`;
};

const extractCompoundCandidates = (analysis: NoteAnalysis) => {
  const phraseScores = new Map<string, number>();

  const addPhrase = (phrase: string, score: number) => {
    const clean = cleanEnd(phrase).toLowerCase();
    const words = clean.split(/\s+/).filter(Boolean);

    if (words.length < 2 || words.length > 3) {
      return;
    }

    if (new Set(words).size !== words.length) {
      return;
    }

    if (words.some((word) => genericPhraseTokens.has(word))) {
      return;
    }

    if (!isUsefulConceptTerm(clean)) {
      return;
    }

    phraseScores.set(clean, (phraseScores.get(clean) ?? 0) + score);
  };

  for (const section of analysis.sections) {
    const tokenBlocks = [
      tokenize(section.title),
      ...section.sentences.map((sentence) => tokenize(sentence))
    ];

    for (const tokens of tokenBlocks) {
      for (let index = 0; index < tokens.length - 1; index += 1) {
        addPhrase(`${tokens[index]} ${tokens[index + 1]}`, 1);
        if (tokens[index + 2]) {
          addPhrase(`${tokens[index]} ${tokens[index + 1]} ${tokens[index + 2]}`, 2);
        }
      }
    }

    for (const relation of section.relations) {
      addPhrase(relation.from, 4);
      addPhrase(relation.to, 4);
    }

    for (const definition of section.definitions) {
      addPhrase(definition.term, 5);
    }
  }

  return [...phraseScores.entries()]
    .sort((left, right) => right[1] - left[1])
    .filter(([, score]) => score >= 2)
    .reduce<ScoredConceptCandidate[]>((selected, [phrase, score]) => {
      const wordBag = phrase.split(/\s+/).sort().join("|");
      const existingBags = new Set(
        selected.map((item) => item.term.split(/\s+/).sort().join("|"))
      );

      if (!existingBags.has(wordBag)) {
        selected.push({ term: phrase, score });
      }

      return selected;
    }, []);
};

const scoreConceptCandidates = (analysis: NoteAnalysis): ScoredConceptCandidate[] => {
  const scores = new Map<string, ScoredConceptCandidate>();
  const referenceAnchors = [
    analysis.topic,
    ...analysis.definitions.map((definition) => definition.term),
    ...analysis.relations.flatMap((relation) => [relation.from, relation.to]),
    ...buildSequenceLabels(analysis.steps)
  ];

  const addCandidate = (term: string, baseScore: number) => {
    const normalized = normalizeConceptTerm(term);

    if (!normalized || !isUsefulConceptTerm(normalized)) {
      return;
    }

    const sectionsWithTerm = analysis.sections.filter((section) =>
      containsWholeWord(
        `${section.title} ${section.rawText}`.toLowerCase(),
        normalized
      )
    ).length;
    const titleBoost = analysis.titleKeywords.some((keyword) =>
      containsWholeWord(normalized, keyword)
    )
      ? 4
      : 0;
    const sentenceBoost = occursInAnySentence(normalized, analysis.rankedSentences) ? 4 : 0;
    const spreadBoost = Math.min(8, sectionsWithTerm * 2);
    const multiWordBoost = wordCount(normalized) >= 2 ? 5 : 0;
    const current =
      scores.get(normalized) ??
      {
        term: normalized,
        score: 0
      };

    current.score += baseScore + titleBoost + sentenceBoost + spreadBoost + multiWordBoost;
    scores.set(normalized, current);
  };

  for (const definition of analysis.definitions) {
    addCandidate(definition.term, 20);
  }

  for (const stepLabel of buildSequenceLabels(analysis.steps)) {
    addCandidate(stepLabel, 18);
  }

  for (const relation of analysis.relations) {
    addCandidate(relation.from, 14);
    addCandidate(relation.to, 14);
  }

  for (const section of analysis.sections) {
    const sectionTitleTokens = tokenize(section.title);

    if (sectionTitleTokens.length >= 2) {
      addCandidate(sectionTitleTokens.slice(-2).join(" "), 10);
    }

    if (sectionTitleTokens.length >= 3) {
      addCandidate(sectionTitleTokens.slice(-3).join(" "), 11);
    }
  }

  for (const candidate of extractCompoundCandidates(analysis)) {
    const overlapsReference =
      sharedTokenRatio(candidate.term, analysis.topic) >= 0.45 ||
      referenceAnchors.some((reference) => sharedTokenRatio(reference, candidate.term) >= 0.45);

    if (overlapsReference) {
      addCandidate(candidate.term, candidate.score * 3);
    }
  }

  for (const keyword of analysis.keywords) {
    addCandidate(keyword, 3);
  }

  const sortedCandidates = [...scores.values()].sort((left, right) => {
    const wordDelta = wordCount(right.term) - wordCount(left.term);
    return right.score - left.score || wordDelta;
  });

  const selected: ScoredConceptCandidate[] = [];
  const multiWordAvailable = sortedCandidates.filter((candidate) => wordCount(candidate.term) >= 2).length;

  for (const candidate of sortedCandidates) {
    const candidateWords = new Set(normalizeConceptTerm(candidate.term).split(/\s+/));
    const subsumedByExisting = selected.some((existing) => {
      const existingWords = new Set(normalizeConceptTerm(existing.term).split(/\s+/));
      const isCovered =
        [...candidateWords].every((word) => existingWords.has(word)) &&
        existingWords.size > candidateWords.size;

      return isCovered && existing.score >= candidate.score - 2;
    });

    if (subsumedByExisting) {
      continue;
    }

    if (
      wordCount(candidate.term) === 1 &&
      multiWordAvailable >= 3 &&
      sortedCandidates.some(
        (other) =>
          other.term !== candidate.term &&
          wordCount(other.term) >= 2 &&
          containsWholeWord(other.term, candidate.term) &&
          other.score >= candidate.score
      )
    ) {
      continue;
    }

    selected.push(candidate);

    if (selected.length >= 6) {
      break;
    }
  }

  if (selected.length >= 3) {
    return selected;
  }

  for (const candidate of sortedCandidates) {
    if (
      selected.findIndex(
        (item) => normalizeConceptTerm(item.term) === normalizeConceptTerm(candidate.term)
      ) === -1
    ) {
      selected.push(candidate);
    }

    if (selected.length >= 6) {
      break;
    }
  }

  return selected;
};

const makeKeyConcepts = (analysis: NoteAnalysis): KeyConcept[] => {
  const candidateTerms = scoreConceptCandidates(analysis).map((candidate) => candidate.term);

  return candidateTerms.map((term) => {
    const lowerTerm = term.toLowerCase();
    const definition = analysis.definitions.find(
      (item) => item.term.toLowerCase() === lowerTerm
    );
    const relation = analysis.relations.find(
      (item) =>
        isCompactTeachingRelation(item) &&
        (item.from.toLowerCase() === lowerTerm || item.to.toLowerCase() === lowerTerm)
    );
    const matchingSentence =
      definition?.sentence ||
      (relation
        ? relation.from.toLowerCase() === lowerTerm
          ? ensureSentence(`${relation.from} ${relation.connector} ${relation.to}`)
          : ensureSentence(`${relation.to} is explained through how ${relation.from} ${relation.connector} it`)
        : "") ||
      sentenceForKeyword(lowerTerm, analysis.rankedSentences) ||
      sentenceForKeyword(lowerTerm, analysis.sections.flatMap((section) => section.sentences)) ||
      `The note keeps returning to ${term} as part of the main explanation.`;
    const sectionHits = analysis.sections.filter((section) =>
      `${section.title} ${section.rawText}`.toLowerCase().includes(lowerTerm)
    ).length;
    const explanation = definition
      ? ensureSentence(`${formatDisplayLabel(definition.term)} means ${cleanEnd(definition.meaning)}`)
      : ensureSentence(compactText(matchingSentence, 26));

    return {
      term: formatDisplayLabel(term),
      explanation,
      importance:
        definition
          ? `It names a core idea that the rest of the note keeps building on.`
          : relation
            ? `It sits inside the note's main logic, so understanding it helps the explanation click faster.`
            : sectionHits >= 2
          ? `It appears across multiple parts of the note and helps connect the lesson together.`
          : `It anchors one of the note's important teaching points.`,
      memoryHook: memoryHookForConcept(term, explanation, analysis.noteType)
    };
  });
};

const makeRelationships = (analysis: NoteAnalysis) => {
  const relationshipLines = analysis.relations
    .filter((relation) => isCompactTeachingRelation(relation))
    .map((relation) => `${relation.from} -> ${relation.connector} -> ${relation.to}`);

  if (!relationshipLines.length && analysis.sections.length > 1) {
    return analysis.sections
      .slice(0, 4)
      .map((section, index, sections) =>
        sections[index + 1]
          ? `${section.title} -> develops into -> ${sections[index + 1].title}`
          : `${analysis.topic} -> resolves in -> ${section.title}`
      )
      .slice(0, 4);
  }

  return uniqueOrdered(relationshipLines).slice(0, 6);
};

const makeLearningPath = (
  analysis: NoteAnalysis,
  sectionInsights: SectionInsight[],
  concepts: KeyConcept[]
) => {
  const compactRelation = analysis.relations.find((relation) => isCompactTeachingRelation(relation));
  const stepLabels = buildSequenceLabels(analysis.steps);
  const path = [
    `Start by locking the core idea: ${cleanEnd(buildTeachingAnchor(analysis))}.`,
    sectionInsights[0]
      ? `Move next through ${sectionInsights
          .slice(0, 3)
          .map((section, index) => getStorySectionTitle(section.title, analysis, index))
          .join(" -> ")}.`
      : "",
    concepts[0]
      ? `Keep ${concepts[0].term} in mind as the main anchor concept while you read.`
      : "",
    stepLabels.length >= 2
      ? `If you need sequence recall, remember: ${stepLabels.slice(0, 4).join(" -> ")}.`
      : "",
    compactRelation
      ? `Connect the cause-and-link logic by remembering that ${compactRelation.from} ${compactRelation.connector} ${compactRelation.to}.`
      : ""
  ];

  return uniqueOrdered(path.filter(Boolean)).slice(0, 5);
};

const makeExamSignals = (
  analysis: NoteAnalysis,
  sectionInsights: SectionInsight[],
  concepts: KeyConcept[]
) => {
  const compactRelation = analysis.relations.find((relation) => isCompactTeachingRelation(relation));
  const stepLabels = buildSequenceLabels(analysis.steps);
  const signals = [
    concepts[0]
      ? `Be ready to define ${concepts[0].term} clearly in one sentence.`
      : "",
    compactRelation
      ? `Be ready to explain the link: ${compactRelation.from} ${compactRelation.connector} ${compactRelation.to}.`
      : "",
    stepLabels.length >= 2
      ? `Be ready to reproduce the sequence in order: ${stepLabels.slice(0, 4).join(" -> ")}.`
      : "",
    sectionInsights[1]
      ? `A strong answer structure is: ${sectionInsights
          .slice(0, 3)
          .map((section, index) => getStorySectionTitle(section.title, analysis, index))
          .join(" -> ")}.`
      : "",
    analysis.noteType === "comparison"
      ? `Expect a contrast-style question where you must show how two parts differ and why that difference matters.`
      : `Expect a question asking how the main idea works, not only what it is.`
  ];

  return uniqueOrdered(signals.filter(Boolean)).slice(0, 5);
};

const makeMemoryHooks = (
  analysis: NoteAnalysis,
  concepts: KeyConcept[],
  relationships: string[]
) => {
  const hooks = [
    ...concepts.slice(0, 3).map((concept) => concept.memoryHook ?? ""),
    relationships[0]
      ? `Picture the lesson as this chain: ${relationships[0].replace(/ -> /g, " ")}.`
      : "",
    analysis.steps.length >= 2
      ? `Hear the note as a rhythm: ${analysis.steps.slice(0, 4).join(", then ")}.`
      : ""
  ];

  return uniqueOrdered(hooks.filter(Boolean)).slice(0, 5);
};

const makeStudyQuestions = (
  analysis: NoteAnalysis,
  concepts: KeyConcept[],
  sectionInsights: SectionInsight[]
) => {
  const compactRelation = analysis.relations.find((relation) => isCompactTeachingRelation(relation));
  const questions = [
    `How would you explain ${analysis.topic} to a beginner using the note's own structure?`,
    concepts[0] ? `Why is ${concepts[0].term} central to the note?` : "",
    compactRelation
      ? `Explain the link: ${compactRelation.from} ${compactRelation.connector} ${compactRelation.to}.`
      : "",
    analysis.steps.length >= 2
      ? `What is the correct sequence described in the note, and why does the order matter?`
      : "",
    sectionInsights[1]
      ? `How does ${sectionInsights[1].title} connect back to the main idea of ${analysis.topic}?`
      : ""
  ];

  return uniqueOrdered(questions.filter(Boolean)).slice(0, 5);
};

const makeFlashcards = (
  analysis: NoteAnalysis,
  concepts: KeyConcept[],
  sectionInsights: SectionInsight[]
): Flashcard[] => {
  const cards: Flashcard[] = [];
  const compactRelation = analysis.relations.find((relation) => isCompactTeachingRelation(relation));

  if (concepts[0]) {
    cards.push({
      front: `What is the core idea behind ${analysis.topic}?`,
      back: cleanEnd(buildTeachingAnchor(analysis))
    });
  }

  for (const concept of concepts.slice(0, 3)) {
    cards.push({
      front: `What does ${concept.term} mean in this note?`,
      back: cleanEnd(concept.explanation)
    });
  }

  if (compactRelation) {
    cards.push({
      front: `How does ${compactRelation.from} relate to ${compactRelation.to}?`,
      back: `${compactRelation.from} ${compactRelation.connector} ${compactRelation.to}.`
    });
  }

  if (analysis.steps.length >= 2) {
    cards.push({
      front: `What sequence should you remember from this note?`,
      back: analysis.steps.slice(0, 4).join(" -> ")
    });
  } else if (sectionInsights[0]) {
    cards.push({
      front: `What is the main takeaway from ${sectionInsights[0].title}?`,
      back: cleanEnd(sectionInsights[0].gist)
    });
  }

  return cards.slice(0, 6);
};

const makeConceptMap = (
  analysis: NoteAnalysis,
  concepts: KeyConcept[],
  relationships: string[],
  sectionInsights: SectionInsight[]
) => {
  const map = [`${analysis.topic} -> core idea -> ${concepts[0]?.term ?? toTitleCase(analysis.keywords[0] ?? "Main Idea")}`];

  for (const relation of relationships.slice(0, 4)) {
    map.push(relation);
  }

  if (map.length < 4) {
    for (let index = 0; index < sectionInsights.length - 1; index += 1) {
      map.push(
        `${sectionInsights[index].title} -> deepens into -> ${sectionInsights[index + 1].title}`
      );
    }
  }

  return uniqueOrdered(map).slice(0, 6);
};

const makeStoryCharacters = (analysis: NoteAnalysis, concepts: KeyConcept[]): StoryCharacter[] => {
  const usedNames = new Set<string>();
  const anchorTerms = uniqueOrdered(
    [
      ...concepts.map((concept) => extractAnchorLabel(concept.term)),
      ...buildSequenceLabels(analysis.steps)
    ].filter(
      (term): term is string =>
        Boolean(term) &&
        normalizeConceptTerm(term) !== normalizeConceptTerm(analysis.topic)
    )
  ).slice(0, 4);

  return anchorTerms.map((term, index) => {
    let name = stablePick(`${analysis.topic}-${term}-${index}`, storyNames);
    let offset = 0;

    while (usedNames.has(name) && offset < storyNames.length) {
      offset += 1;
      name = storyNames[
        (stableIndex(`${analysis.topic}-${term}-${index}`, storyNames.length) + offset) %
          storyNames.length
      ];
    }

    usedNames.add(name);

    return {
      name,
      role: storyRoles[index % storyRoles.length],
      represents: term
    };
  });
};

const makeListeningTips = (analysis: NoteAnalysis) => {
  const stepLabels = buildSequenceLabels(analysis.steps);
  const tips = [
    "Listen once without taking notes, just to feel the full flow of the lesson.",
    stepLabels.length >= 2
      ? `When the sequence appears, quietly repeat the stages in order: ${stepLabels
          .slice(0, 3)
          .join(" -> ")}.`
      : "When a key relationship appears, pause briefly and say it back in your own words.",
    analysis.sourceScope === "selection"
      ? "After listening, compare the story to the selected passage and notice exactly what the scene was trying to teach."
      : "After listening, return to the original note and match each chapter to the part it came from."
  ];

  return uniqueOrdered(tips.filter((value): value is string => Boolean(value))).slice(0, 3);
};

const makeInteractivePrompts = (
  analysis: NoteAnalysis,
  sectionInsights: SectionInsight[],
  concepts: KeyConcept[]
): string[] => {
  const compactRelation = analysis.relations.find((relation) => isCompactTeachingRelation(relation));
  const stepLabels = buildSequenceLabels(analysis.steps);
  const prompts = [
    concepts[0] ? `Can you explain ${concepts[0].term} in one clear sentence` : "",
    stepLabels.length >= 2
      ? `What comes after ${stepLabels[0]} in the sequence`
      : "",
    compactRelation
      ? `Can you say why ${compactRelation.from} ${compactRelation.connector} ${compactRelation.to}`
      : "",
    sectionInsights[1]
      ? `Can you connect ${sectionInsights[1].title} back to the main idea`
      : ""
  ];

  return uniqueOrdered(
    prompts
      .filter((value): value is string => Boolean(value))
      .map((value) => toSpokenQuestion(value))
  ).slice(0, 3);
};

const splitSpeechChunks = (text: string, maxChars = 150) => {
  const spokenText = normalizeWhitespace(text)
    .replace(/[;:]/g, ". ")
    .replace(/\s+/g, " ");
  const sentences = splitSentences(spokenText);

  if (!sentences.length) {
    return [toSpokenSentence(spokenText)];
  }

  const chunks: string[] = [];
  let current = "";

  for (const sentence of sentences) {
    const nextSentence = toSpokenSentence(sentence);
    const nextChunk = current ? `${current} ${nextSentence}` : nextSentence;

    if (nextChunk.length <= maxChars) {
      current = nextChunk;
      continue;
    }

    if (current) {
      chunks.push(current);
    }
    current = nextSentence;
  }

  if (current) {
    chunks.push(current);
  }

  return chunks;
};

const makeStoryArc = (analysis: NoteAnalysis, sectionInsights: SectionInsight[]) => {
  const stepLabels = buildSequenceLabels(analysis.steps);
  const compactRelation = analysis.relations.find((relation) => isCompactTeachingRelation(relation));

  return uniqueOrdered(
    [
      sectionInsights[0]
        ? `Opening: ${getStorySectionTitle(sectionInsights[0].title, analysis, 0)}`
        : `Opening: ${analysis.topic}`,
      sectionInsights[1]
        ? `Development: ${getStorySectionTitle(sectionInsights[1].title, analysis, 1)}`
        : "",
      stepLabels.length >= 2
        ? `Sequence: ${stepLabels.slice(0, 3).join(" -> ")}`
        : compactRelation
          ? `Core Link: ${compactRelation.from} ${compactRelation.connector} ${compactRelation.to}`
          : "",
      `Resolution: ${analysis.topic} becomes clear`
    ].filter(Boolean)
  ).slice(0, 4);
};

const makeDeliveryNotes = (analysis: NoteAnalysis) =>
  uniqueOrdered(
    [
      voiceStyleByNoteType[analysis.noteType],
      analysis.steps.length >= 2
        ? "The voice should slow slightly at each step so the sequence feels easy to follow."
        : "The voice should use clean pauses after each major idea so the lesson never feels rushed.",
      analysis.noteType === "comparison"
        ? "Contrasts should sound clearer than the transitions around them."
        : "Key learning points should sound warmer and slightly more emphasized than the surrounding narration."
    ]
  ).slice(0, 3);

const makeAudioSegments = (input: {
  analysis: NoteAnalysis;
  prologue: string;
  hook: string;
  beats: StoryBeat[];
  takeaway: string;
  reflection: string;
  castLine: string;
  narrator: string;
  interactivePrompts: string[];
}): NarrationSegment[] => {
  const profile = {
    process: { rate: 0.91, pitch: 1.01, pause: 120 },
    system: { rate: 0.9, pitch: 0.99, pause: 140 },
    comparison: { rate: 0.89, pitch: 0.98, pause: 150 },
    concept: { rate: 0.88, pitch: 1.0, pause: 160 },
    mixed: { rate: 0.9, pitch: 1.01, pause: 130 }
  }[input.analysis.noteType];
  const baseRate = profile.rate;
  const basePitch = profile.pitch;
  const basePause = profile.pause;

  const segments: NarrationSegment[] = [
    {
      id: "intro",
      label: "Welcome",
      text: toSpokenSentence(`Welcome to your story lesson. ${input.hook}`),
      intent: "warm",
      rate: baseRate,
      pitch: basePitch + 0.03,
      volume: 0.97,
      pauseAfterMs: 220 + basePause
    },
    {
      id: "prologue",
      label: "Prologue",
      text: toSpokenSentence(input.prologue),
      intent: "guide",
      rate: baseRate - 0.01,
      pitch: basePitch,
      volume: 0.97,
      pauseAfterMs: 240 + basePause
    },
    {
      id: "narrator",
      label: "Narrator",
      text: toSpokenSentence(`Your narrator today is ${input.narrator}. ${input.castLine}`.trim()),
      intent: "guide",
      rate: baseRate - 0.02,
      pitch: basePitch,
      volume: 0.96,
      pauseAfterMs: 240 + basePause
    }
  ];

  input.beats.forEach((beat, index) => {
    const spokenChunks = splitSpeechChunks(beat.audioNarration ?? beat.narration);

    spokenChunks.forEach((chunk, chunkIndex) => {
      segments.push({
        id: `beat_${index + 1}_${chunkIndex + 1}`,
        label: chunkIndex === 0 ? beat.title : `${beat.title} Continued`,
        text: chunk,
        intent: "guide",
        rate: baseRate - (chunkIndex === spokenChunks.length - 1 ? 0.01 : 0),
        pitch: basePitch + (index % 2 === 0 ? 0.02 : 0),
        volume: 0.97,
        pauseAfterMs: 210 + basePause
      });
    });

    segments.push({
      id: `lesson_${index + 1}`,
      label: `Learning Point ${index + 1}`,
      text: toSpokenSentence(`The key idea to remember is this. ${beat.learningPoint}`),
      intent: "emphasis",
      rate: baseRate - 0.03,
      pitch: basePitch + 0.05,
      volume: 0.98,
      pauseAfterMs: 280 + basePause
    });

    if (input.interactivePrompts[index]) {
      segments.push({
        id: `prompt_${index + 1}`,
        label: `Pause Prompt ${index + 1}`,
        text: toSpokenSentence(`Pause here and ask yourself this. ${input.interactivePrompts[index]}`),
        intent: "reflection",
        rate: baseRate - 0.05,
        pitch: basePitch - 0.01,
        volume: 0.95,
        pauseAfterMs: 360 + basePause
      });
    }
  });

  segments.push({
    id: "takeaway",
    label: "Takeaway",
    text: toSpokenSentence(input.takeaway),
    intent: "celebration",
    rate: baseRate - 0.03,
    pitch: basePitch + 0.04,
    volume: 0.98,
    pauseAfterMs: 260 + basePause
  });
  segments.push({
    id: "reflection",
    label: "Reflection",
    text: toSpokenSentence(input.reflection),
    intent: "reflection",
    rate: baseRate - 0.05,
    pitch: basePitch - 0.02,
    volume: 0.95,
    pauseAfterMs: 240 + basePause
  });

  return segments;
};

const makeStory = (
  analysis: NoteAnalysis,
  sectionInsights: SectionInsight[],
  concepts: KeyConcept[],
  learningPath: string[]
): StoryArtifact => {
  const world = stablePick(analysis.topic, storyWorlds[analysis.noteType]);
  const characters = makeStoryCharacters(analysis, concepts);
  const interactivePrompts = makeInteractivePrompts(analysis, sectionInsights, concepts);
  const listeningTips = makeListeningTips(analysis);
  const storyArc = makeStoryArc(analysis, sectionInsights);
  const deliveryNotes = makeDeliveryNotes(analysis);
  const landmarks = storyLandmarksByNoteType[analysis.noteType];
  const trimmedSections = sectionInsights.slice(0, 4);
  const beats: StoryBeat[] = trimmedSections.map((section, index) => {
    const guide = characters[index % Math.max(characters.length, 1)] ?? {
      name: stablePick(analysis.topic, storyNames),
      role: "guide",
      represents: concepts[0]?.term ?? analysis.topic
    };
    const chapterLabel = getStoryChapterLabel(index, trimmedSections.length);
    const displayTitle = getStorySectionTitle(section.title, analysis, index);
    const focus = section.focusPoints.length
      ? joinNaturalList(section.focusPoints.slice(0, 2))
      : "";
    const lessonLine =
      /^This part moves from /i.test(section.gist) && section.focusPoints.length >= 2
        ? `The sequence moves through ${joinNaturalList(section.focusPoints.slice(0, 3))}.`
        : ensureSentence(section.gist);
    const sceneLocation = landmarks[index % landmarks.length];
    const nextTitle =
      trimmedSections[index + 1]
        ? getStorySectionTitle(trimmedSections[index + 1].title, analysis, index + 1)
        : "";
    const narration = chooseBestNativeVariant({
      topic: analysis.topic,
      fallback: `${chapterLabel}: In ${sceneLocation}, ${guide.name}, the ${guide.role}, opens ${displayTitle} and explains that ${cleanEnd(lessonLine)}.${focus ? ` The clearest anchors are ${focus}.` : ""}${nextTitle ? ` This prepares the learner for ${nextTitle}.` : ""}`.trim(),
      variants: [
        `${chapterLabel}: In ${sceneLocation}, ${guide.name}, the ${guide.role}, opens ${displayTitle} and explains that ${cleanEnd(lessonLine)}.${focus ? ` The clearest anchors are ${focus}.` : ""}${nextTitle ? ` This prepares the learner for ${nextTitle}.` : ""}`.trim(),
        `${chapterLabel}: ${displayTitle} begins at ${sceneLocation}, where ${guide.name} carefully shows that ${cleanEnd(lessonLine)}.${focus ? ` The learner keeps ${focus} in mind.` : ""}${nextTitle ? ` Next, the lesson moves toward ${nextTitle}.` : ""}`.trim(),
        `${chapterLabel}: ${guide.name} guides the learner through ${displayTitle} and makes one point clear: ${cleanEnd(lessonLine)}.${focus ? ` Hold on to ${focus}.` : ""}${nextTitle ? ` It naturally leads into ${nextTitle}.` : ""}`.trim()
      ]
    });
    const audioNarration = [
      `${chapterLabel}. ${displayTitle}.`,
      `Here is the part that matters now. ${toSpokenSentence(lessonLine)}`,
      focus ? `Keep these anchors close. ${toSpokenSentence(focus)}` : "",
      nextTitle ? `This chapter prepares the next idea, ${toSpokenSentence(nextTitle)}` : ""
    ]
      .filter(Boolean)
      .join(" ");

    return {
      title: displayTitle,
      chapterLabel,
      narration,
      audioNarration,
      learningPoint: cleanEnd(lessonLine),
      focus
    };
  });

  if (!beats.length) {
    beats.push({
      title: "Core Lesson",
      chapterLabel: "Opening",
      narration: `Opening: The guide opens the heart of the lesson and reveals that ${cleanEnd(buildStandaloneTopicExplanation(analysis))}.`,
      audioNarration: `Opening. ${toSpokenSentence(buildStandaloneTopicExplanation(analysis))}`,
      learningPoint: cleanEnd(buildStandaloneTopicExplanation(analysis)),
      focus: concepts[0]?.term ?? analysis.topic
    });
  }

  const hook =
    analysis.sourceScope === "selection"
      ? `This selected note passage becomes a guided story lesson inside ${world.setting}.`
      : `This full note becomes a guided story lesson inside ${world.setting}.`;
  const prologue = chooseBestNativeVariant({
    topic: analysis.topic,
    fallback: `Inside ${world.setting}, ${world.frame}. The learner is not here to memorize blindly. The learner is here to understand why ${cleanEnd(buildStandaloneTopicExplanation(analysis))}.`,
    variants: [
      `Inside ${world.setting}, ${world.frame}. The learner is not here to memorize blindly. The learner is here to understand why ${cleanEnd(buildStandaloneTopicExplanation(analysis))}.`,
      `The story opens in ${world.setting}, where ${world.frame}. The lesson begins with one clear truth: ${cleanEnd(buildStandaloneTopicExplanation(analysis))}.`,
      `In ${world.setting}, the guide prepares the learner for one focused lesson. ${cleanEnd(buildStandaloneTopicExplanation(analysis))}.`
    ]
  });

  const scenes = beats.map(
    (beat) => `${beat.chapterLabel ?? beat.title}: ${beat.narration}`
  );
  const takeaway = chooseBestNativeVariant({
    topic: analysis.topic,
    fallback: `By the end of the story, the learner can clearly explain that ${cleanEnd(buildStandaloneTopicExplanation(analysis))}.`,
    variants: [
      `By the end of the story, the learner can clearly explain that ${cleanEnd(buildStandaloneTopicExplanation(analysis))}.`,
      `The story closes with one clear understanding: ${cleanEnd(buildStandaloneTopicExplanation(analysis))}.`,
      `When the story ends, the learner can say with confidence that ${cleanEnd(buildStandaloneTopicExplanation(analysis))}.`
    ]
  });
  const reflection = learningPath[1]
    ? `To check understanding, retell the lesson in your own words using this path: ${learningPath[1].replace(/^Move next through /, "").replace(/\.$/, "")}.`
    : `To check understanding, retell the opening idea, the central mechanism, and the final takeaway without looking back at the note.`;
  const castLine =
    characters.length > 0
      ? `Meet ${characters
          .map((character) => `${character.name}, who represents ${character.represents}`)
          .join("; ")}.`
      : "";
  const audioSegments = makeAudioSegments({
    analysis,
    prologue,
    hook,
    beats,
    takeaway,
    reflection,
    castLine,
    narrator: world.narrator,
    interactivePrompts
  });
  const audioScript = audioSegments.map((segment) => segment.text).join(" ");

  return {
    title: `${analysis.topic} as a Story`,
    hook,
    prologue,
    storyArc,
    setting: world.setting,
    narrator: world.narrator,
    voiceStyle: voiceStyleByNoteType[analysis.noteType],
    characters,
    beats,
    scenes,
    takeaway,
    reflection,
    deliveryNotes,
    listeningTips,
    interactivePrompts,
    audioSegments,
    audioScript
  };
};

const renderSummary = (artifact: Omit<SummaryArtifact, "rendered">) => {
  const sections: string[] = [];

  if (artifact.format === "bullets") {
    return (artifact.quickTakeaways ?? artifact.bullets).map((item) => `- ${item}`).join("\n");
  }

  if (artifact.format === "paragraph") {
    return [
      artifact.directSummary,
      ...(artifact.quickTakeaways ?? []).slice(0, 2),
      artifact.story?.takeaway ?? artifact.overview
    ]
      .filter(Boolean)
      .join("\n\n");
  }

  if (artifact.format === "flashcards") {
    return artifact.flashcards.map((card) => `Q: ${card.front}\nA: ${card.back}`).join("\n\n");
  }

  if (artifact.format === "concept-map") {
    return artifact.conceptMap.map((item) => `- ${item}`).join("\n");
  }

  if (artifact.format === "storyboard") {
    return [
      artifact.directSummary,
      artifact.story?.hook ?? artifact.overview,
      artifact.story?.prologue ?? "",
      ...((artifact.story?.storyArc ?? []).map((item) => `Arc: ${item}`)),
      ...(artifact.story?.beats ?? []).map(
        (beat) =>
          `${beat.chapterLabel ? `${beat.chapterLabel}: ` : ""}${beat.title}\n${beat.narration}\nLearning point: ${beat.learningPoint}${beat.focus ? `\nFocus anchors: ${beat.focus}` : ""}`
      ),
      artifact.story?.takeaway ?? "",
      artifact.story?.reflection ?? "",
      ...((artifact.story?.interactivePrompts ?? []).map((prompt) => `Prompt: ${prompt}`))
    ]
      .filter(Boolean)
      .join("\n\n");
  }

  sections.push(`Direct Summary\n${artifact.directSummary}`);
  if (artifact.formatGuide) {
    sections.push(`Format Guide\n${artifact.formatGuide}`);
  }
  sections.push(`Overview\n${artifact.overview}`);

  if (artifact.quickTakeaways?.length) {
    sections.push(`Quick Takeaways\n${artifact.quickTakeaways.map((item) => `- ${item}`).join("\n")}`);
  }

  if (artifact.sectionInsights?.length) {
    sections.push(
      `Section Map\n${artifact.sectionInsights
        .map(
          (section) =>
            `- ${section.title}: ${section.gist}${section.focusPoints.length ? ` | Focus: ${section.focusPoints.join(", ")}` : ""}`
        )
        .join("\n")}`
    );
  }

  sections.push(`Key Points\n${artifact.bullets.map((item) => `- ${item}`).join("\n")}`);

  sections.push(
    `Key Concepts\n${artifact.keyConcepts
      .map(
        (concept) =>
          `- ${concept.term}: ${concept.explanation}${concept.importance ? ` ${concept.importance}` : ""}`
      )
      .join("\n")}`
  );

  if (artifact.relationships?.length) {
    sections.push(`Relationships\n${artifact.relationships.map((item) => `- ${item}`).join("\n")}`);
  }

  if (artifact.learningPath?.length) {
    sections.push(`Learning Path\n${artifact.learningPath.map((item) => `- ${item}`).join("\n")}`);
  }

  if (artifact.examSignals?.length) {
    sections.push(`Exam Signals\n${artifact.examSignals.map((item) => `- ${item}`).join("\n")}`);
  }

  sections.push(`Study Questions\n${artifact.studyQuestions.map((item) => `- ${item}`).join("\n")}`);

  if (artifact.story) {
    sections.push(
      `Story Mode\n${artifact.story.hook}\n${artifact.story.prologue ?? ""}\n${(artifact.story.beats ?? [])
        .map((beat) => `- ${beat.chapterLabel ? `${beat.chapterLabel}: ` : ""}${beat.title}: ${beat.learningPoint}`)
        .join("\n")}`
    );
    if (artifact.story.listeningTips?.length) {
      sections.push(
        `Listening Tips\n${artifact.story.listeningTips.map((tip) => `- ${tip}`).join("\n")}`
      );
    }
  }

  return sections.join("\n\n");
};

export const generateSummary = (input: {
  pageId: string;
  notebookId: string;
  title: string;
  content: string;
  selectionText?: string;
  mode: SummaryMode;
  format: SummaryFormat;
}): SummaryRecord => {
  const normalizedContent = normalizeWhitespace(input.content);
  const sourceText = normalizeWhitespace(input.selectionText || normalizedContent);

  if (!sourceText) {
    throw new Error("The selected note is empty. Add some content before asking SNSAI to summarize it.");
  }

  const analysis = analyzeNote({
    title: input.title,
    sourceText,
    sourceScope: input.selectionText ? "selection" : "page"
  });
  const sectionInsights = makeSectionInsights(analysis);
  const keyConcepts = makeKeyConcepts(analysis);
  const relationships = makeRelationships(analysis);
  const learningPath = makeLearningPath(analysis, sectionInsights, keyConcepts);
  const examSignals = makeExamSignals(analysis, sectionInsights, keyConcepts);
  const memoryHooks = makeMemoryHooks(analysis, keyConcepts, relationships);
  const quickTakeaways = makeQuickTakeaways(analysis, sectionInsights, relationships);
  const directSummary = makeDirectSummary(
    input.mode,
    analysis,
    sectionInsights,
    relationships
  );
  const bullets = makeBullets(input.mode, quickTakeaways);
  const studyQuestions = makeStudyQuestions(analysis, keyConcepts, sectionInsights);
  const flashcards = makeFlashcards(analysis, keyConcepts, sectionInsights);
  const conceptMap = makeConceptMap(analysis, keyConcepts, relationships, sectionInsights);
  const story = makeStory(analysis, sectionInsights, keyConcepts, learningPath);

  const baseArtifact: Omit<SummaryArtifact, "rendered"> = {
    title: `${analysis.topic} | ${toTitleCase(input.mode)} Summary`,
    mode: input.mode,
    format: input.format,
    engine: `${BASE_ENGINE_NAME} + ${getNativeModelName()}`,
    sourceScope: input.selectionText ? "selection" : "page",
    sourcePreview: sourceText.slice(0, 220),
    directSummary,
    overview: makeOverview(input.mode, analysis),
    bullets,
    quickTakeaways,
    formatGuide: makeFormatGuide(input.format, input.mode),
    keyConcepts,
    sectionInsights,
    relationships,
    learningPath,
    examSignals,
    memoryHooks,
    flashcards,
    conceptMap,
    studyQuestions,
    story,
    metrics: {
      wordCount: sourceText.split(/\s+/).filter(Boolean).length,
      sentenceCount:
        analysis.sections.flatMap((section) => section.sentences).length || 1,
      readingTimeMinutes: estimateReadingTime(
        sourceText.split(/\s+/).filter(Boolean).length
      )
    }
  };

  const artifact: SummaryArtifact = {
    ...baseArtifact,
    rendered: renderSummary(baseArtifact)
  };

  return {
    id: `summary_${crypto.randomUUID().slice(0, 8)}`,
    pageId: input.pageId,
    notebookId: input.notebookId,
    mode: input.mode,
    format: input.format,
    sourceScope: artifact.sourceScope,
    sourceSelection: input.selectionText?.slice(0, 400) ?? "",
    createdAt: new Date().toISOString(),
    artifact
  };
};
