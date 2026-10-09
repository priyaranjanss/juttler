export function generateId(prefix: string): string {
  return prefix + Math.random().toString(36).substring(2, 9);
}
