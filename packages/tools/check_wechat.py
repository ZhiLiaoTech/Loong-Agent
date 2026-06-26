import subprocess
import sys
import os

print("CWD:", os.getcwd())

try:
    result = subprocess.run(['tasklist'], capture_output=True, text=True)
    output = result.stdout
    wechat_lines = [l for l in output.split('\n') if 'WeChat' in l]
    if wechat_lines:
        print("[OK] WeChat is running:")
        for line in wechat_lines:
            print(line)
    else:
        print("[NOT FOUND] WeChat not running")
except Exception as e:
    print(f"Error: {e}")
    sys.exit(1)
