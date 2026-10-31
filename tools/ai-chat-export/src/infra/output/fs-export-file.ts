import { rename, writeFile } from 'node:fs/promises';

import type {
  ExportFile,
  WriteExportFileRequest,
  WriteExportFileResponse,
} from '../../domain/output/export-file.js';

/** Writes through a temporary file and a rename, so an interrupted run never leaves half a file. */
export class FsExportFile implements ExportFile {
  async write(req: WriteExportFileRequest): Promise<WriteExportFileResponse> {
    const temporary = `${req.path}.tmp`;
    await writeFile(temporary, req.content, 'utf8');
    await rename(temporary, req.path);
    return {};
  }
}
