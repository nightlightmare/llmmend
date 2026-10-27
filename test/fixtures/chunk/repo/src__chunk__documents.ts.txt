import { type Chunk, type ChunkOptions, chunkText } from './split'

/** A text to split, with metadata that every one of its chunks carries. */
export interface ChunkDocument<Metadata = unknown> {
  text: string
  metadata?: Metadata
}

/** A chunk of one of several documents: `doc` is its position in the input. */
export type DocumentChunk<Metadata = unknown> = Chunk & { doc: number; metadata: Metadata }

/**
 * Splits several documents (files, pages) with `chunkText` and returns all their chunks in one
 * array, each with its document's position and metadata. `index` counts within each document;
 * chunks never overlap across documents.
 */
export function chunkDocuments<Doc extends ChunkDocument>(
  docs: readonly Doc[],
  options: ChunkOptions,
): DocumentChunk<Doc['metadata']>[] {
  return docs.flatMap((document, doc) =>
    chunkText(document.text, options).map((chunk) => ({
      ...chunk,
      doc,
      metadata: document.metadata as Doc['metadata'],
    })),
  )
}
