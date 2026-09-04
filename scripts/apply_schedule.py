import json
from pathlib import Path
from datetime import datetime, timezone

ROOT = Path(__file__).resolve().parents[1]
config_path = ROOT / "Web" / "remote-config.json"
schedule_path = ROOT / "Web" / "schedule.json"
config = json.loads(config_path.read_text(encoding="utf-8"))
schedule = json.loads(schedule_path.read_text(encoding="utf-8"))
now = datetime.now(timezone.utc)
changed = False
for entry in schedule.get("entries", []):
    if not entry.get("enabled", True) or entry.get("applied", False):
        continue
    when = datetime.fromisoformat(entry["at"].replace("Z", "+00:00"))
    if now >= when:
        channel = entry["channel"]
        slot = int(entry["slot"])
        if channel in config.get("channels", {}):
            config["channels"][channel] = slot
            config["version"] = int(config.get("version", 0)) + 1
            config["updatedAt"] = now.isoformat().replace("+00:00", "Z")
            entry["applied"] = True
            changed = True
if changed:
    config_path.write_text(json.dumps(config, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    schedule_path.write_text(json.dumps(schedule, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print("CHANGED=1")
else:
    print("CHANGED=0")
