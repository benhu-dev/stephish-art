export const parseEmailOutboxArguments = (arguments_: string[]) => {
  if (arguments_.length === 0) return;
  throw new Error("email:deliver does not accept arguments.");
};
