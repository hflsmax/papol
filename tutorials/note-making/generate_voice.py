from pathlib import Path

import numpy as np
import soundfile as sf
from kokoro import KPipeline


root = Path(__file__).parent
lines = [line.strip() for line in (root / "narration.txt").read_text().splitlines() if line.strip()]
starts = [0.3, 4.6, 10.4, 13.8, 17.3, 23.7, 29.5, 37.0, 45.2, 49.6, 54.0]
pipeline = KPipeline(lang_code="a")
sample_rate = 24_000
track = np.zeros(60 * sample_rate, dtype=np.float32)
previous_end = 0

for line, start in zip(lines, starts, strict=True):
    pieces = [audio for _, _, audio in pipeline(line, voice="af_heart", speed=0.9)]
    audio = np.concatenate(pieces)
    offset = round(start * sample_rate)
    end = offset + len(audio)
    if offset < previous_end:
        raise RuntimeError(f"Narration lines overlap before: {line}")
    if end > len(track):
        raise RuntimeError(f"Narration line would be clipped: {line}")
    track[offset:end] = audio
    previous_end = end
    print(f"{start:.3f}-{end / sample_rate:.3f}: {line}")

sf.write(root / "narration.wav", track, sample_rate)
