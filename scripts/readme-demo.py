"""把 scripts/readme-demo.mjs 截的帧合成动画 WebP：python3 scripts/readme-demo.py <outDir> <目标.webp> [运行帧毫秒]"""
import json, sys
from PIL import Image
out, dest = sys.argv[1], sys.argv[2]
run_ms = int(sys.argv[3]) if len(sys.argv) > 3 else 280
tl = json.load(open(f'{out}/timeline.json'))
frames = [Image.open(f"{out}/frames/{t['f']}").convert('RGB') for t in tl]
durs = [run_ms if t['ms'] <= 500 else t['ms'] for t in tl]
frames[0].save(dest, save_all=True, append_images=frames[1:], duration=durs, loop=0, quality=72, method=6)
print(dest, len(frames), 'frames', sum(durs) / 1000, 's')
