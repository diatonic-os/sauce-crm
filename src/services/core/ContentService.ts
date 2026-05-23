// CON-OBS-INTEG-001 · T-C3-01 · CW-content — unified facade over the content
// core plugins (audio-recorder, canvas, outline, page-preview, footnotes-view,
// word-count, slides, web-viewer).
//
// web-viewer access (fetchWeb) respects the user's privacy setting: when
// `allowWebFetch` is false the call is refused rather than silently reaching out.

export interface OutlineHeading {
  level: number;
  text: string;
  line: number;
}

export interface ContentHost {
  recordAudio(): Promise<string>; // returns the created attachment path
  readCanvas(path: string): Promise<unknown>;
  outline(path: string): Promise<OutlineHeading[]>;
  preview(path: string): Promise<string>; // rendered HTML/preview string
  footnotes(path: string): Promise<string[]>;
  wordCount(path: string): Promise<number>;
  present(path: string): Promise<void>; // slides
  fetchWeb(url: string): Promise<string>;
}

/** Privacy gate (injected) — reads the user's web-viewer/privacy setting. */
export interface PrivacyGate {
  allowWebFetch(): boolean;
}

export class ContentService {
  constructor(
    private readonly host: ContentHost,
    private readonly privacy: PrivacyGate,
  ) {}

  recordAudio(): Promise<string> {
    return this.host.recordAudio();
  }
  readCanvas(path: string): Promise<unknown> {
    return this.host.readCanvas(path);
  }
  outline(path: string): Promise<OutlineHeading[]> {
    return this.host.outline(path);
  }
  preview(path: string): Promise<string> {
    return this.host.preview(path);
  }
  footnotes(path: string): Promise<string[]> {
    return this.host.footnotes(path);
  }
  wordCount(path: string): Promise<number> {
    return this.host.wordCount(path);
  }
  present(path: string): Promise<void> {
    return this.host.present(path);
  }

  /** web-viewer fetch — refused unless the user opted into web access (privacy). */
  fetchWeb(url: string): Promise<string> {
    if (!this.privacy.allowWebFetch()) {
      return Promise.reject(
        new Error("Web fetch disabled by privacy settings"),
      );
    }
    return this.host.fetchWeb(url);
  }
}
