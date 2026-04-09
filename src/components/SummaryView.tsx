import { AudioNarrator } from "./AudioNarrator";
import { SummaryRecord } from "../types";

interface SummaryViewProps {
  summary: SummaryRecord;
}

export const SummaryView = ({ summary }: SummaryViewProps) => {
  const { artifact } = summary;
  const sectionInsights = artifact.sectionInsights ?? [];
  const relationships = artifact.relationships ?? [];
  const learningPath = artifact.learningPath ?? [];
  const examSignals = artifact.examSignals ?? [];
  const memoryHooks = artifact.memoryHooks ?? [];
  const storyBeats = artifact.story?.beats ?? [];
  const storyCharacters = artifact.story?.characters ?? [];
  const storyArc = artifact.story?.storyArc ?? [];
  const deliveryNotes = artifact.story?.deliveryNotes ?? [];
  const quickTakeaways = artifact.quickTakeaways ?? [];
  const listeningTips = artifact.story?.listeningTips ?? [];
  const interactivePrompts = artifact.story?.interactivePrompts ?? [];
  const directSummary = artifact.directSummary || artifact.overview;
  const formatGuide = artifact.formatGuide ?? "";

  return (
    <div className="summary-stack">
      <section className="summary-section">
        <div className="summary-header">
          <div>
            <p className="eyebrow">SNSAI Output</p>
            <h2>{artifact.title}</h2>
          </div>
          <div className="chip-row">
            <span className="chip">{artifact.engine}</span>
            <span className="chip">{artifact.metrics.wordCount} words</span>
            <span className="chip">{artifact.metrics.readingTimeMinutes} min read</span>
          </div>
        </div>
        <div className="direct-summary-card">
          <p className="eyebrow">Direct Summary</p>
          <p className="summary-overview">{directSummary}</p>
        </div>
        {formatGuide ? (
          <div className="mini-note compact-note">{formatGuide}</div>
        ) : null}
        <p className="summary-overview">{artifact.overview}</p>
      </section>

      {quickTakeaways.length ? (
        <section className="summary-section">
          <h3>Easy Summary</h3>
          <div className="mini-note-grid">
            {quickTakeaways.map((takeaway) => (
              <div className="mini-note" key={takeaway}>
                {takeaway}
              </div>
            ))}
          </div>
        </section>
      ) : null}

      <section className="summary-section">
        <h3>Key Points</h3>
        <div className="bullet-grid">
          {artifact.bullets.map((bullet) => (
            <article className="mini-card" key={bullet}>
              {bullet}
            </article>
          ))}
        </div>
      </section>

      <section className="summary-section">
        <h3>Key Concepts</h3>
        <div className="concept-grid">
          {artifact.keyConcepts.map((concept) => (
            <article className="mini-card" key={concept.term}>
              <strong>{concept.term}</strong>
              <p>{concept.explanation}</p>
              {concept.importance ? <p>{concept.importance}</p> : null}
              {concept.memoryHook ? (
                <div className="mini-note compact-note">{concept.memoryHook}</div>
              ) : null}
            </article>
          ))}
        </div>
      </section>

      {sectionInsights.length ? (
        <section className="summary-section">
          <h3>Section Understanding</h3>
          <div className="story-scenes">
            {sectionInsights.map((section) => (
              <article className="story-scene" key={section.title}>
                <strong>{section.title}</strong>
                <p>{section.gist}</p>
                {section.focusPoints.length ? (
                  <div className="chip-row compact-row">
                    {section.focusPoints.map((point) => (
                      <span className="chip" key={point}>
                        {point}
                      </span>
                    ))}
                  </div>
                ) : null}
              </article>
            ))}
          </div>
        </section>
      ) : null}

      {relationships.length ? (
        <section className="summary-section">
          <h3>Relationships</h3>
          <div className="mini-note-grid">
            {relationships.map((item) => (
              <div className="mini-note" key={item}>
                {item}
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {learningPath.length ? (
        <section className="summary-section">
          <h3>Learning Path</h3>
          <div className="mini-note-grid">
            {learningPath.map((step) => (
              <div className="mini-note" key={step}>
                {step}
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {examSignals.length ? (
        <section className="summary-section">
          <h3>Exam Signals</h3>
          <div className="mini-note-grid">
            {examSignals.map((signal) => (
              <div className="mini-note" key={signal}>
                {signal}
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {memoryHooks.length ? (
        <section className="summary-section">
          <h3>Memory Hooks</h3>
          <div className="mini-note-grid">
            {memoryHooks.map((hook) => (
              <div className="mini-note" key={hook}>
                {hook}
              </div>
            ))}
          </div>
        </section>
      ) : null}

      <section className="summary-section">
        <h3>Flashcards</h3>
        <div className="flashcard-grid">
          {artifact.flashcards.map((card) => (
            <article className="flashcard" key={card.front}>
              <p className="flashcard-label">Front</p>
              <strong>{card.front}</strong>
              <p className="flashcard-label">Back</p>
              <p>{card.back}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="summary-section">
        <h3>Concept Map</h3>
        <div className="mini-note-grid">
          {artifact.conceptMap.map((item) => (
            <div className="mini-note" key={item}>
              {item}
            </div>
          ))}
        </div>
      </section>

      <section className="summary-section">
        <h3>Study Questions</h3>
        <div className="mini-note-grid">
          {artifact.studyQuestions.map((question) => (
            <div className="mini-note" key={question}>
              {question}
            </div>
          ))}
        </div>
      </section>

      {artifact.story ? (
        <section className="summary-section story-section">
          <h3>{artifact.story.title}</h3>
          <p className="summary-overview">{artifact.story.hook}</p>
          {artifact.story.prologue ? (
            <div className="mini-note">{artifact.story.prologue}</div>
          ) : null}
          {artifact.story.setting || artifact.story.narrator ? (
            <div className="mini-note story-meta">
              {artifact.story.setting ? <p><strong>Setting:</strong> {artifact.story.setting}</p> : null}
              {artifact.story.narrator ? <p><strong>Narrator:</strong> {artifact.story.narrator}</p> : null}
            </div>
          ) : null}
          {storyArc.length ? (
            <div className="mini-note-grid">
              {storyArc.map((item) => (
                <div className="mini-note" key={item}>
                  {item}
                </div>
              ))}
            </div>
          ) : null}
          {storyCharacters.length ? (
            <div className="concept-grid">
              {storyCharacters.map((character) => (
                <article className="mini-card" key={`${character.name}-${character.represents}`}>
                  <strong>{character.name}</strong>
                  <p>{character.role}</p>
                  <div className="mini-note compact-note">
                    Represents {character.represents}
                  </div>
                </article>
              ))}
            </div>
          ) : null}
          {storyBeats.length ? (
            <div className="story-scenes">
              {storyBeats.map((beat) => (
                <article className="story-scene" key={beat.title}>
                  <strong>{beat.chapterLabel ? `${beat.chapterLabel}: ${beat.title}` : beat.title}</strong>
                  <p>{beat.narration}</p>
                  <div className="mini-note compact-note">
                    Learning point: {beat.learningPoint}
                  </div>
                  {beat.focus ? (
                    <div className="mini-note compact-note">
                      Focus anchors: {beat.focus}
                    </div>
                  ) : null}
                </article>
              ))}
            </div>
          ) : (
            <div className="story-scenes">
              {artifact.story.scenes.map((scene) => (
                <article className="story-scene" key={scene}>
                  {scene}
                </article>
              ))}
            </div>
          )}
          <div className="mini-note">{artifact.story.takeaway}</div>
          {artifact.story.reflection ? (
            <div className="mini-note">{artifact.story.reflection}</div>
          ) : null}
          {deliveryNotes.length ? (
            <div className="mini-note-grid">
              {deliveryNotes.map((note) => (
                <div className="mini-note" key={note}>
                  {note}
                </div>
              ))}
            </div>
          ) : null}
          {listeningTips.length ? (
            <div className="mini-note-grid">
              {listeningTips.map((tip) => (
                <div className="mini-note" key={tip}>
                  {tip}
                </div>
              ))}
            </div>
          ) : null}
          {interactivePrompts.length ? (
            <div className="story-scenes">
              {interactivePrompts.map((prompt) => (
                <article className="story-scene" key={prompt}>
                  <strong>Interactive Prompt</strong>
                  <p>{prompt}</p>
                </article>
              ))}
            </div>
          ) : null}
          <AudioNarrator
            summaryId={summary.id}
            title={artifact.title}
            script={artifact.story.audioScript}
            segments={artifact.story.audioSegments}
            voiceStyle={artifact.story.voiceStyle}
          />
        </section>
      ) : null}

      <section className="summary-section">
        <h3>Rendered Format</h3>
        <pre className="rendered-output">{artifact.rendered}</pre>
      </section>
    </div>
  );
};
