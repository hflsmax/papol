// The Worker's half of a table the app's suite reads too
// (frontend/src/linkParity.test.js): the app ports these readings
// (shared/videos.js, shared/identifiers.js), and a port that drifts makes
// cards the Worker refuses and identifiers it would not have read.
import { describe, expect, it } from "vitest";

import table from "../../shared/testing/linkParity.json";
import { bilibiliVideo, videoLink, youtubeId } from "../src/videos";
import { extractArxivId, extractDoi } from "../src/papers/identifiers";

describe("a video link", () => {
  for (const { name, url, youtubeId: id, bilibiliVideo: bilibili, videoLink: link } of table.videos) {
    it(`is read as the app reads it: ${name}`, () => {
      expect(youtubeId(url)).toBe(id);
      expect(bilibiliVideo(url)).toEqual(bilibili);
      expect(videoLink(url)).toEqual(link);
    });
  }
});

describe("an identifier in extracted text", () => {
  for (const { name, text, doi, arxivId } of table.identifiers) {
    it(`is read as the app reads it: ${name}`, () => {
      expect(extractDoi(text)).toBe(doi);
      expect(extractArxivId(text)).toBe(arxivId);
    });
  }
});
