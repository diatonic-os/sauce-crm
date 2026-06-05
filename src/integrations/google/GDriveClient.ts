// SPEC §22.1 — Google Drive v3 metadata-only client (read-only by default).
import { GDriveFileMeta, GoogleSubClientOpts, googleGetJson } from "./types";

export class GDriveClient {
  constructor(public opts: GoogleSubClientOpts) {}

  async listFiles(
    params: {
      q?: string;
      pageSize?: number;
      pageToken?: string;
      orderBy?: string;
    } = {},
  ): Promise<{ files: GDriveFileMeta[]; nextPageToken?: string }> {
    const fields =
      "files(id,name,mimeType,webViewLink,modifiedTime,size,owners(emailAddress,displayName)),nextPageToken";
    const r = await googleGetJson<{
      files?: GDriveFileMeta[];
      nextPageToken?: string;
    }>(this.opts, "/drive/v3/files", {
      q: params.q,
      pageSize: params.pageSize ?? 100,
      pageToken: params.pageToken,
      orderBy: params.orderBy ?? "modifiedTime desc",
      fields,
    });
    return {
      files: r.files ?? [],
      ...(r.nextPageToken !== undefined
        ? { nextPageToken: r.nextPageToken }
        : {}),
    };
  }

  async getMeta(fileId: string): Promise<GDriveFileMeta> {
    return googleGetJson<GDriveFileMeta>(
      this.opts,
      `/drive/v3/files/${encodeURIComponent(fileId)}`,
      {
        fields:
          "id,name,mimeType,webViewLink,modifiedTime,size,owners(emailAddress,displayName)",
      },
    );
  }
}
