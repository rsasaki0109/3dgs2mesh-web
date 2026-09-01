export function friendlyError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/memory|allocate|grid/i.test(message))
    return `${message} Try the Fast preset or a smaller crop.`;
  if (/truncated|header|property|PLY/i.test(message)) return message;
  if (/cancel/i.test(message)) return "Conversion cancelled.";
  return message || "Something went wrong while converting this file.";
}
