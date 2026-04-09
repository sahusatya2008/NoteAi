import { useEffect, useRef, useState } from "react";
import { api } from "../lib/api";
import { NarrationSegment, StoryAudioFormat, TtsStatus } from "../types";

interface AudioNarratorProps {
  summaryId: string;
  title: string;
  script: string;
  segments?: NarrationSegment[];
  voiceStyle?: string;
}

type NarratorStyleId = "gentle" | "clear" | "cinematic";

const clampValue = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), max);

const narratorStyles: Record<
  NarratorStyleId,
  {
    label: string;
    note: string;
    rateShift: number;
    pitchShift: number;
    pauseShift: number;
    volumeShift: number;
  }
> = {
  gentle: {
    label: "Gentle Mentor",
    note: "Soft, smooth, and easier on the ear for long study sessions.",
    rateShift: -0.03,
    pitchShift: 0.01,
    pauseShift: 90,
    volumeShift: -0.02
  },
  clear: {
    label: "Clear Teacher",
    note: "Balanced pacing with stronger clarity for revision and explanation.",
    rateShift: -0.02,
    pitchShift: 0,
    pauseShift: 70,
    volumeShift: 0
  },
  cinematic: {
    label: "Story Guide",
    note: "Slower and more dramatic, with stronger pauses between ideas.",
    rateShift: -0.05,
    pitchShift: -0.01,
    pauseShift: 120,
    volumeShift: 0.01
  }
};

const normalizeSpeechText = (value: string) =>
  value
    .replace(/\b([A-Z]{2,6})\b/g, (match) => match.split("").join(" "))
    .replace(/\bCO2\b/g, "C O 2")
    .replace(/\bO2\b/g, "O 2")
    .replace(/\bH2O\b/g, "H 2 O")
    .replace(/\bATP\b/g, "A T P")
    .replace(/&/g, "and")
    .replace(/\//g, " or ")
    .replace(/\s*->\s*/g, " then ")
    .replace(/\.(?=[A-Za-z])/g, ". ")
    .replace(/\s+/g, " ")
    .trim();

const splitSpeechChunks = (value: string, maxChars = 135) => {
  const normalized = normalizeSpeechText(value).replace(/[;:]/g, ". ");
  const sentences =
    normalized
      .split(/(?<=[.!?])\s+/)
      .map((item) => item.trim())
      .filter(Boolean) || [];

  if (!sentences.length) {
    return normalized ? [normalized] : [];
  }

  const chunks: string[] = [];
  let current = "";

  for (const sentence of sentences) {
    const next = current ? `${current} ${sentence}` : sentence;
    if (next.length <= maxChars) {
      current = next;
      continue;
    }

    if (current) {
      chunks.push(current);
    }
    current = sentence;
  }

  if (current) {
    chunks.push(current);
  }

  return chunks;
};

const preferredVoiceScore = (voice: SpeechSynthesisVoice) => {
  const name = `${voice.name} ${voice.lang}`.toLowerCase();
  let score = 0;

  if (/^en[-_]/.test(voice.lang.toLowerCase()) || /english/.test(name)) {
    score += 10;
  }

  if (/natural|enhanced|premium|siri|neural/.test(name)) {
    score += 15;
  }

  if (/samantha|karen|moira|tessa|rishi|daniel|ava|allison|serena|aria|susan|zira|hazel|sonia|neural/.test(name)) {
    score += 10;
  }

  if (/google uk english female|google us english|samantha|ava|allison|serena|daniel|karen|moira|tessa|alex|rishi/.test(name)) {
    score += 8;
  }

  if (/compact|espeak|festival|orca|eloquence|desktop|bad news|bahh|bells|boing|bubbles|cellos|whisper|wobble|zarvox/.test(name)) {
    score -= 20;
  }

  if (voice.localService) {
    score += 3;
  }

  return score;
};

const choosePreferredVoice = (voices: SpeechSynthesisVoice[]) =>
  [...voices].sort((left, right) => preferredVoiceScore(right) - preferredVoiceScore(left))[0];

export const AudioNarrator = ({
  summaryId,
  title,
  script,
  segments = [],
  voiceStyle
}: AudioNarratorProps) => {
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [voiceURI, setVoiceURI] = useState("");
  const [rate, setRate] = useState(0.97);
  const [expressiveness, setExpressiveness] = useState(0.95);
  const [narratorStyle, setNarratorStyle] = useState<NarratorStyleId>("clear");
  const [status, setStatus] = useState<"idle" | "playing">("idle");
  const [ttsStatus, setTtsStatus] = useState<TtsStatus | null>(null);
  const [serverVoice, setServerVoice] = useState("");
  const [serverFormat, setServerFormat] = useState<StoryAudioFormat>("mp3");
  const [serverAudioUrl, setServerAudioUrl] = useState("");
  const [serverBusy, setServerBusy] = useState(false);
  const [serverMessage, setServerMessage] = useState("");
  const [serverError, setServerError] = useState("");
  const playbackTokenRef = useRef(0);
  const timeoutRef = useRef<number | null>(null);
  const serverAudioRef = useRef<HTMLAudioElement | null>(null);
  const supported = typeof window !== "undefined" && "speechSynthesis" in window;

  useEffect(() => {
    if (supported) {
      const loadVoices = () => {
        const availableVoices = window.speechSynthesis.getVoices();
        setVoices(availableVoices);

        if (!voiceURI && availableVoices.length) {
          const preferred = choosePreferredVoice(availableVoices);
          setVoiceURI(preferred?.voiceURI ?? availableVoices[0].voiceURI);
        }
      };

      loadVoices();
      window.speechSynthesis.onvoiceschanged = loadVoices;
    }

    const loadTtsStatus = async () => {
      try {
        const nextStatus = await api.getTtsStatus();
        setTtsStatus(nextStatus);
        setServerMessage(nextStatus.message);
        if (!serverVoice) {
          setServerVoice(nextStatus.defaultVoice);
        }
      } catch (error) {
        setServerError(error instanceof Error ? error.message : "Unable to load SNSAI voice status.");
      }
    };

    void loadTtsStatus();

    return () => {
      playbackTokenRef.current += 1;
      if (supported) {
        window.speechSynthesis.cancel();
        window.speechSynthesis.onvoiceschanged = null;
      }
      if (timeoutRef.current) {
        window.clearTimeout(timeoutRef.current);
      }
    };
  }, [supported, voiceURI]);

  useEffect(() => {
    return () => {
      if (serverAudioUrl) {
        URL.revokeObjectURL(serverAudioUrl);
      }
    };
  }, [serverAudioUrl]);

  useEffect(() => {
    if (ttsStatus && !serverVoice) {
      setServerVoice(ttsStatus.defaultVoice);
    }
  }, [ttsStatus, serverVoice]);

  const selectedVoice = voices.find((voice) => voice.voiceURI === voiceURI);
  const styleProfile = narratorStyles[narratorStyle];

  const speakChunkQueue = (
    chunks: string[],
    chunkIndex: number,
    segment: NarrationSegment,
    token: number,
    onComplete: () => void
  ) => {
    if (token !== playbackTokenRef.current) {
      setStatus("idle");
      return;
    }

    if (chunkIndex >= chunks.length) {
      timeoutRef.current = window.setTimeout(onComplete, segment.pauseAfterMs + styleProfile.pauseShift);
      return;
    }

    const utterance = new SpeechSynthesisUtterance(chunks[chunkIndex]);

    if (selectedVoice) {
      utterance.voice = selectedVoice;
      utterance.lang = selectedVoice.lang;
    } else {
      utterance.lang = "en-US";
    }

    const intentStyle = {
      warm: { rate: -0.01, pitch: 0.02, volume: 0.01 },
      guide: { rate: -0.01, pitch: 0, volume: 0 },
      emphasis: { rate: -0.02, pitch: 0.03, volume: 0.01 },
      reflection: { rate: -0.04, pitch: -0.01, volume: -0.02 },
      celebration: { rate: -0.01, pitch: 0.02, volume: 0.01 }
    }[segment.intent];

    utterance.rate = clampValue(
      segment.rate * rate + intentStyle.rate * expressiveness + styleProfile.rateShift,
      0.8,
      1
    );
    utterance.pitch = clampValue(
      segment.pitch + intentStyle.pitch * expressiveness + styleProfile.pitchShift,
      0.92,
      1.12
    );
    utterance.volume = clampValue(
      segment.volume + intentStyle.volume * expressiveness + styleProfile.volumeShift,
      0.84,
      0.98
    );
    utterance.onend = () => {
      if (token !== playbackTokenRef.current) {
        return;
      }

      timeoutRef.current = window.setTimeout(
        () => speakChunkQueue(chunks, chunkIndex + 1, segment, token, onComplete),
        chunkIndex === chunks.length - 1 ? 0 : 160
      );
    };
    utterance.onerror = () => {
      setStatus("idle");
    };

    window.speechSynthesis.speak(utterance);
  };

  const speakSegmentQueue = (queue: NarrationSegment[], index: number, token: number) => {
    if (token !== playbackTokenRef.current || index >= queue.length) {
      setStatus("idle");
      return;
    }

    const segment = queue[index];
    const chunks = splitSpeechChunks(segment.text);

    if (!chunks.length) {
      speakSegmentQueue(queue, index + 1, token);
      return;
    }

    speakChunkQueue(chunks, 0, segment, token, () => {
      speakSegmentQueue(queue, index + 1, token);
    });
  };

  const play = () => {
    if (!supported) {
      return;
    }

    playbackTokenRef.current += 1;
    const token = playbackTokenRef.current;
    window.speechSynthesis.cancel();

    if (timeoutRef.current) {
      window.clearTimeout(timeoutRef.current);
    }

    setStatus("playing");

    if (segments.length) {
      speakSegmentQueue(segments, 0, token);
      return;
    }

    const utterance = new SpeechSynthesisUtterance(script);

    if (selectedVoice) {
      utterance.voice = selectedVoice;
      utterance.lang = selectedVoice.lang;
    } else {
      utterance.lang = "en-US";
    }

    utterance.text = splitSpeechChunks(script, 160).join(" ");
    utterance.rate = clampValue(rate + styleProfile.rateShift, 0.82, 0.99);
    utterance.pitch = clampValue(0.99 + styleProfile.pitchShift, 0.94, 1.1);
    utterance.volume = clampValue(0.95 + styleProfile.volumeShift, 0.85, 0.98);
    utterance.onend = () => setStatus("idle");
    utterance.onerror = () => setStatus("idle");
    window.speechSynthesis.speak(utterance);
  };

  const stop = () => {
    playbackTokenRef.current += 1;
    if (supported) {
      window.speechSynthesis.cancel();
    }
    if (timeoutRef.current) {
      window.clearTimeout(timeoutRef.current);
    }
    setStatus("idle");
  };

  const handleServerAudio = async () => {
    try {
      setServerBusy(true);
      setServerError("");
      setServerMessage("SNSAI is rendering native story audio...");
      const response = await api.generateStoryAudio({
        summaryId,
        voice: serverVoice || ttsStatus?.defaultVoice,
        format: serverFormat,
        speed: clampValue(rate, 0.85, 1.12)
      });
      const nextUrl = URL.createObjectURL(response.blob);
      if (serverAudioUrl) {
        URL.revokeObjectURL(serverAudioUrl);
      }
      setServerAudioUrl(nextUrl);
      setServerMessage(
        response.headers.get("X-SNSAI-TTS-Trimmed") === "true"
          ? "Story audio is ready. SNSAI compacted the script slightly to fit the export limit."
          : "Story audio is ready to play or download."
      );
      window.setTimeout(() => {
        serverAudioRef.current?.load();
      }, 0);
    } catch (error) {
      setServerError(error instanceof Error ? error.message : "Unable to generate SNSAI story audio.");
    } finally {
      setServerBusy(false);
    }
  };

  const downloadName =
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "snsai-story";

  return (
    <div className="narrator-card">
      {voiceStyle ? <div className="mini-note compact-note">{voiceStyle}</div> : null}
      {supported ? (
        <>
          <div className="narrator-controls">
            <select
              value={voiceURI}
              onChange={(event) => setVoiceURI(event.target.value)}
              className="field"
            >
              {voices.map((voice) => (
                <option key={voice.voiceURI} value={voice.voiceURI}>
                  {voice.name}
                </option>
              ))}
            </select>
            <div className="range-field">
              <span>Narration Pace</span>
              <input
                type="range"
                min="0.9"
                max="1.02"
                step="0.01"
                value={rate}
                onChange={(event) => setRate(Number(event.target.value))}
              />
            </div>
            <div className="range-field">
              <span>Voice Color</span>
              <input
                type="range"
                min="0.8"
                max="1.1"
                step="0.05"
                value={expressiveness}
                onChange={(event) => setExpressiveness(Number(event.target.value))}
              />
            </div>
            <select
              value={narratorStyle}
              onChange={(event) => setNarratorStyle(event.target.value as NarratorStyleId)}
              className="field"
            >
              {Object.entries(narratorStyles).map(([key, value]) => (
                <option key={key} value={key}>
                  {value.label}
                </option>
              ))}
            </select>
          </div>
          <div className="mini-note compact-note">{narratorStyles[narratorStyle].note}</div>
          <div className="narrator-buttons">
            <button type="button" className="button-primary" onClick={play}>
              {status === "playing" ? "Replay Story" : "Play Story"}
            </button>
            <button type="button" className="button-ghost" onClick={stop}>
              Stop
            </button>
          </div>
        </>
      ) : (
        <div className="mini-note">
          Browser speech playback is not available here, but SNSAI can still use local story playback text.
        </div>
      )}

      <div className="narrator-divider" />

      <div className="narrator-export">
        <div className="narrator-export-head">
          <div>
            <strong>SNSAI Story Audio Lab</strong>
            <p>Play instantly in the browser, or render a cleaner native audio file from your local studio voices.</p>
          </div>
          {ttsStatus ? (
            <div className="chip-row">
              <span className="chip">{ttsStatus.available ? "Native Voice Ready" : "Browser Voice"}</span>
              <span className="chip">{ttsStatus.model}</span>
            </div>
          ) : null}
        </div>

        {serverMessage ? <div className="mini-note compact-note">{serverMessage}</div> : null}
        {serverError ? <div className="error-banner">{serverError}</div> : null}

        {ttsStatus?.available ? (
          <>
            <div className="narrator-controls">
              <select
                value={serverVoice}
                onChange={(event) => setServerVoice(event.target.value)}
                className="field"
              >
                {ttsStatus.voices.map((voice) => (
                  <option key={voice.id} value={voice.id}>
                    {voice.label} · {voice.tone}
                  </option>
                ))}
              </select>
              <select
                value={serverFormat}
                onChange={(event) => setServerFormat(event.target.value as StoryAudioFormat)}
                className="field narrator-format"
              >
                {ttsStatus.formats.map((format) => (
                  <option key={format} value={format}>
                    {format.toUpperCase()}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="button-primary"
                onClick={handleServerAudio}
                disabled={serverBusy}
              >
                {serverBusy ? "Rendering Audio..." : "Render Native Audio"}
              </button>
            </div>

            {serverAudioUrl ? (
              <div className="premium-audio-panel">
                <audio ref={serverAudioRef} controls className="premium-audio-player">
                  <source src={serverAudioUrl} />
                </audio>
                <a
                  className="button-ghost premium-download"
                  href={serverAudioUrl}
                  download={`${downloadName}.${serverFormat}`}
                >
                  Download Audio
                </a>
              </div>
            ) : null}
          </>
        ) : (
          <div className="mini-note">
            Browser narration is ready now. Native studio export is not available on this
            machine yet.
          </div>
        )}
      </div>
    </div>
  );
};
