import { execFile } from "child_process";
import { promises as fs } from "fs";
import os from "os";
import path from "path";
import {
  StoryAudioFormat,
  SummaryRecord,
  TtsStatus,
  TtsVoiceOption
} from "../../types";

const nativeModelName = "SNSAI Native Voice Studio";
const maxSpeechCharacters = 12000;
const supportedFormats: StoryAudioFormat[] = ["mp3", "wav", "opus"];
const preferredVoiceOrder = [
  "Samantha",
  "Karen",
  "Moira",
  "Daniel",
  "Rishi",
  "Tessa",
  "Eddy (English (US))",
  "Eddy (English (UK))",
  "Reed (English (US))",
  "Reed (English (UK))",
  "Flo (English (US))",
  "Flo (English (UK))"
];
const noveltyVoicePattern =
  /^(?:Bad News|Bahh|Bells|Boing|Bubbles|Cellos|Good News|Grandma|Jester|Junior|Organ|Pipe Organ|Superstar|Trinoids|Whisper|Wobble|Zarvox|Albert)$/i;

let voiceCachePromise: Promise<TtsVoiceOption[]> | null = null;

const compactWhitespace = (value: string) => value.replace(/\s+/g, " ").trim();

const slugify = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64) || "snsai-story";

const clipText = (value: string, limit: number) => {
  if (value.length <= limit) {
    return compactWhitespace(value);
  }

  const clipped = value.slice(0, limit);
  const sentenceBoundary = Math.max(
    clipped.lastIndexOf(". "),
    clipped.lastIndexOf("? "),
    clipped.lastIndexOf("! ")
  );

  if (sentenceBoundary > Math.floor(limit * 0.55)) {
    return compactWhitespace(clipped.slice(0, sentenceBoundary + 1));
  }

  const wordBoundary = clipped.lastIndexOf(" ");
  return compactWhitespace(clipped.slice(0, wordBoundary > 0 ? wordBoundary : limit));
};

const makeSpeechFriendlyText = (value: string) =>
  compactWhitespace(value)
    .replace(/\bSNSAI\b/g, "S N S A I")
    .replace(/\bCO2\b/g, "C O 2")
    .replace(/\bO2\b/g, "O 2")
    .replace(/\bH2O\b/g, "H 2 O")
    .replace(/\s*->\s*/g, " then ")
    .replace(/&/g, " and ");

const describeVoiceTone = (voiceName: string, locale: string) => {
  const name = voiceName.toLowerCase();

  if (name.includes("samantha")) {
    return "Warm and smooth for gentle teaching stories.";
  }

  if (name.includes("daniel")) {
    return "Polished and clear for structured explanations.";
  }

  if (name.includes("moira")) {
    return "Thoughtful and steady for deeper study sessions.";
  }

  if (name.includes("karen")) {
    return "Bright and friendly for approachable summaries.";
  }

  if (name.includes("rishi")) {
    return "Calm and direct for focused revision.";
  }

  if (name.includes("tessa")) {
    return "Soft and elegant for slower storytelling.";
  }

  if (name.includes("eddy")) {
    return "Modern and balanced for clear spoken lessons.";
  }

  if (name.includes("reed")) {
    return "Measured and grounded for long listening.";
  }

  if (name.includes("flo")) {
    return "Expressive and smooth for story-led learning.";
  }

  return locale.startsWith("en_")
    ? "Natural local voice for polished SNSAI narration."
    : "Installed local voice.";
};

const execFileAsync = (file: string, args: string[]) =>
  new Promise<string>((resolve, reject) => {
    execFile(file, args, { encoding: "utf8", maxBuffer: 8 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(stderr?.trim() || error.message));
        return;
      }

      resolve(stdout);
    });
  });

const parseVoiceList = (output: string) =>
  output
    .split("\n")
    .map((line) => line.trimEnd())
    .map((line) => {
      const match = line.match(/^(?<name>.+?)\s{2,}(?<locale>[a-z]{2}_[A-Z]{2})\s+#/);
      if (!match?.groups?.name || !match.groups.locale) {
        return null;
      }

      return {
        name: match.groups.name.trim(),
        locale: match.groups.locale.trim()
      };
    })
    .filter((item): item is { name: string; locale: string } => Boolean(item))
    .filter(
      (item) =>
        item.locale.toLowerCase().startsWith("en_") &&
        !noveltyVoicePattern.test(item.name)
    )
    .sort((left, right) => {
      const leftPreferred = preferredVoiceOrder.indexOf(left.name);
      const rightPreferred = preferredVoiceOrder.indexOf(right.name);
      const leftRank = leftPreferred === -1 ? preferredVoiceOrder.length + 5 : leftPreferred;
      const rightRank = rightPreferred === -1 ? preferredVoiceOrder.length + 5 : rightPreferred;

      return leftRank - rightRank || left.name.localeCompare(right.name);
    })
    .map<TtsVoiceOption>((item) => ({
      id: item.name,
      label: item.name,
      tone: describeVoiceTone(item.name, item.locale)
    }));

const getNativeVoices = async () => {
  if (!voiceCachePromise) {
    voiceCachePromise = execFileAsync("/usr/bin/say", ["-v", "?"])
      .then(parseVoiceList)
      .catch(() => []);
  }

  return voiceCachePromise;
};

const pickDefaultVoice = (voices: TtsVoiceOption[]) => {
  const requested = process.env.SNSAI_NATIVE_VOICE?.trim();
  if (requested && voices.some((voice) => voice.id === requested)) {
    return requested;
  }

  for (const preferred of preferredVoiceOrder) {
    if (voices.some((voice) => voice.id === preferred)) {
      return preferred;
    }
  }

  return voices[0]?.id ?? "";
};

const normalizeVoice = (value: string | undefined, voices: TtsVoiceOption[]) => {
  const candidate = value?.trim();
  if (candidate && voices.some((voice) => voice.id === candidate)) {
    return candidate;
  }

  return pickDefaultVoice(voices);
};

const mimeTypeForFormat = (format: StoryAudioFormat) =>
  ({
    mp3: "audio/mpeg",
    wav: "audio/wav",
    opus: "audio/ogg"
  })[format];

const buildSpeechScript = (summary: SummaryRecord) => {
  const story = summary.artifact.story;
  const segmentText =
    story?.audioSegments?.length
      ? story.audioSegments.map((segment) => makeSpeechFriendlyText(segment.text))
      : makeSpeechFriendlyText(story?.audioScript || summary.artifact.rendered).split(/\n+/);

  let assembled = "";
  let trimmed = false;

  for (const segment of segmentText) {
    if (!segment) {
      continue;
    }

    const addition = assembled ? `${assembled}\n\n${segment}` : segment;
    if (addition.length <= maxSpeechCharacters) {
      assembled = addition;
      continue;
    }

    const remaining = maxSpeechCharacters - assembled.length - (assembled ? 2 : 0);
    if (remaining > 120) {
      assembled = assembled
        ? `${assembled}\n\n${clipText(segment, remaining)}`
        : clipText(segment, maxSpeechCharacters);
    }
    trimmed = true;
    break;
  }

  const rawScript = assembled || makeSpeechFriendlyText(story?.audioScript || summary.artifact.rendered);

  return {
    script: rawScript,
    trimmed: trimmed || rawScript.length > maxSpeechCharacters
  };
};

const nativeRateFromSpeed = (speed: number | undefined) => {
  const normalized =
    typeof speed === "number" && Number.isFinite(speed)
      ? Math.min(1.2, Math.max(0.85, speed))
      : 1;

  return String(Math.round(165 * normalized));
};

const convertAudioFormat = async (
  sourcePath: string,
  outputPath: string,
  format: StoryAudioFormat
) => {
  if (format === "wav") {
    await execFileAsync("/usr/bin/afconvert", [
      "-f",
      "WAVE",
      "-d",
      "LEI16@22050",
      sourcePath,
      outputPath
    ]);
    return;
  }

  if (format === "mp3") {
    await execFileAsync("ffmpeg", [
      "-y",
      "-loglevel",
      "error",
      "-i",
      sourcePath,
      "-codec:a",
      "libmp3lame",
      "-q:a",
      "4",
      outputPath
    ]);
    return;
  }

  await execFileAsync("ffmpeg", [
    "-y",
    "-loglevel",
    "error",
    "-i",
    sourcePath,
    "-c:a",
    "libopus",
    "-b:a",
    "64k",
    outputPath
  ]);
};

export const getTtsStatus = async (): Promise<TtsStatus> => {
  const voices = await getNativeVoices();
  const available = voices.length > 0;

  return {
    provider: available ? "native" : "none",
    available,
    model: nativeModelName,
    defaultVoice: available ? pickDefaultVoice(voices) : "",
    formats: supportedFormats,
    voices,
    message: available
      ? "SNSAI native story audio is ready with local studio voices."
      : "SNSAI native story audio is not available on this machine."
  };
};

export const generateStoryAudio = async (
  summary: SummaryRecord,
  input: {
    voice?: string;
    format?: StoryAudioFormat;
    speed?: number;
  }
) => {
  const status = await getTtsStatus();
  if (!status.available) {
    throw new Error("SNSAI native story audio is not available on this machine.");
  }

  const selectedVoice = normalizeVoice(input.voice, status.voices);
  const selectedFormat = supportedFormats.includes(input.format ?? "mp3")
    ? (input.format ?? "mp3")
    : "mp3";
  const { script, trimmed } = buildSpeechScript(summary);
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "snsai-voice-"));
  const scriptPath = path.join(tempDir, "story.txt");
  const rawAudioPath = path.join(tempDir, "story.aiff");
  const outputPath = path.join(tempDir, `story.${selectedFormat}`);

  try {
    await fs.writeFile(scriptPath, script, "utf8");
    await execFileAsync("/usr/bin/say", [
      "-v",
      selectedVoice,
      "-r",
      nativeRateFromSpeed(input.speed),
      "-o",
      rawAudioPath,
      "-f",
      scriptPath
    ]);
    await convertAudioFormat(rawAudioPath, outputPath, selectedFormat);

    return {
      audioBuffer: await fs.readFile(outputPath),
      contentType: mimeTypeForFormat(selectedFormat),
      fileName: `${slugify(summary.artifact.title)}.${selectedFormat}`,
      format: selectedFormat,
      model: nativeModelName,
      provider: "native" as const,
      voice: selectedVoice,
      trimmed
    };
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
};
