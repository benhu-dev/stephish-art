export const createBoundedStorageStream = (
  source: ReadableStream<Uint8Array>,
  expectedBytes: number,
  maximumBytes: number,
  errorPrefix: "STORAGE_STREAM" | "UPLOAD_STREAM" = "STORAGE_STREAM",
) => {
  const reader = source.getReader();
  let receivedBytes = 0;

  return new ReadableStream<Uint8Array>({
    async cancel(reason) {
      await reader.cancel(reason);
    },
    async pull(controller) {
      try {
        const chunk = await reader.read();
        if (chunk.done) {
          if (receivedBytes !== expectedBytes) {
            controller.error(new Error(`${errorPrefix}_LENGTH_MISMATCH`));
          } else {
            controller.close();
          }
          return;
        }

        receivedBytes += chunk.value.byteLength;
        if (receivedBytes > expectedBytes || receivedBytes > maximumBytes) {
          await reader.cancel();
          controller.error(new Error(`${errorPrefix}_LENGTH_MISMATCH`));
          return;
        }
        controller.enqueue(chunk.value);
      } catch {
        controller.error(new Error(`${errorPrefix}_UNAVAILABLE`));
      }
    },
  });
};
