import json
with open('/Users/arbaz/.gemini/antigravity-ide/brain/c337c1b3-00bc-4d73-8661-d05978f41097/.system_generated/logs/transcript_full.jsonl', 'r') as f:
    for line in f:
        data = json.loads(line)
        if data.get("type") == "BROWSER_SUBAGENT":
            # Let's search inside the subagent actions
            content = data.get("content", "")
            if "capture_browser_console_logs" in content:
                print("FOUND SUBAGENT LOG:")
                print(content)
