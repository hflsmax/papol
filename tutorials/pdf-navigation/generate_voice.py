from pathlib import Path

import numpy as np
import soundfile as sf
from kokoro import KPipeline


root = Path(__file__).parent
lines = [line.strip() for line in (root / "narration.txt").read_text().splitlines() if line.strip()]
starts = [0.3, 6.2, 11.3, 16.7, 20.2, 26.5, 31.4, 34.8, 42.6]
pipeline = KPipeline(lang_code="a")
sample_rate = 24_000
track = np.zeros(45 * sample_rate, dtype=np.float32)
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
