/** Writes the export to disk. */
export interface ExportFile {
  write(req: WriteExportFileRequest): Promise<WriteExportFileResponse>;
}

export interface WriteExportFileRequest {
  path: string;
  content: string;
}

export type WriteExportFileResponse = Record<string, never>;
