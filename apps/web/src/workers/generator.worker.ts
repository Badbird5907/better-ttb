import {
  createDoneMessage,
  createErrorMessage,
  createStartedMessage,
  isGeneratorWorkerRequest,
} from "./generator-contract";

type WorkerScope = {
  addEventListener: (
    type: "message",
    listener: (event: MessageEvent<unknown>) => void,
  ) => void;
  postMessage: (message: unknown) => void;
};

const worker = self as unknown as WorkerScope;

worker.addEventListener("message", (event: MessageEvent<unknown>) => {
  if (!isGeneratorWorkerRequest(event.data)) {
    return;
  }

  const request = event.data;
  worker.postMessage(createStartedMessage(request));

  try {
    worker.postMessage(createDoneMessage(request));
  } catch (error) {
    worker.postMessage(createErrorMessage(request, error));
  }
});
