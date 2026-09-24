import { StorefrontApiError } from "./storefrontApiError";
import { MAX_ARTIST_NOTE_CHARACTERS } from "../../lib/artistNoteContract";

export { MAX_ARTIST_NOTE_CHARACTERS };

export const normalizeArtistNote = (value: string): string | null => {
  const normalized = value.replaceAll("\r\n", "\n").trim();
  if (normalized.length > MAX_ARTIST_NOTE_CHARACTERS) {
    throw new StorefrontApiError(422, "ARTIST_NOTE_TOO_LONG");
  }
  return normalized || null;
};

export const parseArtistNoteRequest = (value: unknown) => {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    Object.keys(value).length !== 1 ||
    !("artistNote" in value) ||
    typeof value.artistNote !== "string"
  ) {
    throw new StorefrontApiError(400, "INVALID_REQUEST");
  }

  return { artistNote: normalizeArtistNote(value.artistNote) };
};
