import { IS_DESKTOP } from './appEnvironment.js';
import { backendPath } from './appUrls.js';
import { runtimeFetch } from './connectivity.js';
import { nativeBlobBytes, nativeBlobCache } from './nativeData.js';

const video = (path, sha256) => Object.freeze({ path, sha256, mimeType: 'video/mp4', kind: 'video' });

export const tutorialMedia = Object.freeze({
  uploadingPdf: video('/assets/learn/uploading-a-pdf.mp4', 'f7723d633b33d8bf189446c0df12095edae4f61e92d0ffa17038d2d7c4ead6d8'),
  clippingFigures: video('/assets/learn/clipping-functionality.mp4', '60d1d71eccddb19ea035d2b4cba34f6f287a6eff5074732dd13a27229681e4d1'),
  pdfNavigation: video('/assets/learn/pdf-navigation.mp4', '30b1689cdee0ea5f7643480e645bd8f7f0cb858035d0b0668cd5092f0fc524e4'),
  animalFunctionality: video('/assets/learn/animal-functionality.mp4', 'dff43402548232cc4ea27a857c6c368550580c3827da435cbd8c57d04fff2121'),
  boardBasics: video('/assets/learn/board-basics.mp4', 'b100a981286ff4e91017cd2722ad6bf9f425b67f04f65e330a4687cb2f55c010'),
  boardGrouping: video('/assets/learn/board-grouping.mp4', 'e6b6f1cebd884fe974db5b6c44d482d7fe0b64f1477dc9543951f3d9f34feb7d'),
  viewerToBoard: video('/assets/learn/viewer-to-board.mp4', 'd68dd8954a9fa2b363ae88fa2a85d5a0a8cdb9041bf56a93b5f68135ced5683c'),
  noteMaking: video('/assets/learn/note-making.mp4', 'e0e83823fa694c874b352e609509d064b4a2a9fc9cad2a1bc7868f51723f52be'),
});

const allMedia = Object.values(tutorialMedia);
const inFlightBySha = new Map();

class DesktopMediaUnavailableError extends Error {
  constructor(kind, cause) {
    super(`This ${kind} requires a network connection.`);
    this.name = 'DesktopMediaUnavailableError';
    this.cause = cause;
  }
}

export function hydrateDesktopMedia(asset) {
  if (!IS_DESKTOP) throw new Error('Desktop media hydration is only available in Papol macOS');

  let hydration = inFlightBySha.get(asset.sha256);
  if (hydration) return hydration;

  hydration = nativeBlobBytes(asset.sha256).catch(async () => {
    try {
      const response = await runtimeFetch(backendPath(asset.path));
      if (!response.ok) throw new Error(`Media request failed with status ${response.status}`);
      const blob = await response.blob();
      return await nativeBlobCache(asset.sha256, blob, asset.mimeType);
    } catch (error) {
      throw new DesktopMediaUnavailableError(asset.kind, error);
    }
  });
  inFlightBySha.set(asset.sha256, hydration);
  const forget = () => {
    if (inFlightBySha.get(asset.sha256) === hydration) inFlightBySha.delete(asset.sha256);
  };
  hydration.then(forget, forget);
  return hydration;
}

// Start immediately, but keep launch interactive and cap network/disk pressure.
export async function startDesktopMediaHydration() {
  if (!IS_DESKTOP) return [];
  let next = 0;
  const results = [];
  const worker = async () => {
    while (next < allMedia.length) {
      const asset = allMedia[next];
      next += 1;
      try {
        await hydrateDesktopMedia(asset);
        results.push({ asset, hydrated: true });
      } catch (error) {
        results.push({ asset, hydrated: false, error });
      }
    }
  };
  await Promise.all([worker(), worker()]);
  return results;
}
