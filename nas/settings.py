"""Settings for the Gearizo NAS job, read from a JSON file that stays on this computer (never in git).

The file is ~/.gearizo-secrets/supabase.json unless GEARIZO_CONFIG points elsewhere. Fields:
  url        Supabase project URL                         (required)
  secretKey  Supabase secret key (sb_secret_...)          (required, keep private)
  ownerId    user id that new NAS versions are credited to (the content owner)
  nasRoot    where the "Marketing Content" share is mounted (default /Volumes/Marketing Content)
  ffmpeg     path to ffmpeg                               (default: found on PATH)
  dataDir    where logs, previews and state are kept      (default: this folder)
  sync       true = make previews and move approved files  (default true)
  autopost   true = upload scheduled posts to Instagram/Facebook (default true)
Only ONE computer should have autopost on at a time.
"""
import json, os, shutil

PATH = os.environ.get("GEARIZO_CONFIG") or os.path.expanduser("~/.gearizo-secrets/supabase.json")
CFG = json.load(open(PATH))
URL, KEY = CFG["url"], CFG["secretKey"]
OWNER_ID = CFG.get("ownerId", "")
NAS_ROOT = CFG.get("nasRoot", "/Volumes/Marketing Content")
FFMPEG = CFG.get("ffmpeg") or shutil.which("ffmpeg") or os.path.expanduser("~/.local/bin/ffmpeg")
DATA = CFG.get("dataDir") or os.path.dirname(os.path.abspath(__file__))
SYNC = bool(CFG.get("sync", True))
AUTOPOST = bool(CFG.get("autopost", True))
os.makedirs(DATA, exist_ok=True)
