import { WorkspaceStore } from "../data/store";
import { retrainNativeModel } from "../services/native-model";

const run = async () => {
  const status = await retrainNativeModel(new WorkspaceStore());

  console.log("SNSAI Native NLM rebuilt successfully.");
  console.log(`Documents: ${status.documentCount}`);
  console.log(`Vocabulary: ${status.vocabularySize}`);
  console.log(`Transitions: ${status.transitionCount}`);
  console.log(`Top phrases: ${status.topPhrases.join(", ")}`);
};

void run().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
