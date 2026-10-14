/**
 * Surgical file edits (Cursor/OpenCode-style search_replace).
 * Pure helpers — no GitHub I/O here so they are easy to unit test.
 */

export interface SearchReplaceResult {
  content: string;
  replacements: number;
}

/**
 * Replace old_string with new_string in file content.
 * Fails clearly when the anchor is missing or ambiguous (unless replace_all).
 */
export function applySearchReplace(
  content: string,
  oldString: string,
  newString: string,
  replaceAll = false
): SearchReplaceResult {
  if (!oldString) {
    throw new Error('old_string is required — copy an exact snippet from get_file.');
  }
  if (oldString === newString) {
    throw new Error('old_string and new_string are identical — nothing to change.');
  }

  const occurrences = content.split(oldString).length - 1;
  if (occurrences === 0) {
    throw new Error(
      'old_string was not found in the file. Re-read with get_file and copy the exact text to replace (including whitespace).'
    );
  }
  if (occurrences > 1 && !replaceAll) {
    throw new Error(
      `old_string matched ${occurrences} places. Pass a larger unique snippet, or set replace_all=true.`
    );
  }

  const next = replaceAll ? content.split(oldString).join(newString) : content.replace(oldString, newString);
  return { content: next, replacements: replaceAll ? occurrences : 1 };
}
