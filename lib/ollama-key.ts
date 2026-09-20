/** Accept a raw key, a quoted key, or a copied environment assignment/header. */
export function normalizeOllamaKey(value: string): string {
  let key = value.trim();
  key = key.replace(/^(?:export\s+)?OLLAMA_(?:API_KEY|API)\s*=\s*/i, "");
  const unquote = (text: string) => {
    const pairs: Record<string, string> = { '"': '"', "'": "'", "“": "”", "‘": "’" };
    return text.length >= 2 && pairs[text[0]] === text[text.length - 1] ? text.slice(1, -1).trim() : text;
  };
  key = unquote(key);
  key = key.replace(/^(?:Authorization:\s*)?Bearer\s+/i, "");
  return unquote(key).trim();
}
