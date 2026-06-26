"""
微信消息发送脚本 v3 — 更健壮的窗口检测 + 托盘恢复
"""
import pyautogui
import pygetwindow as gw
import pyperclip
import time
import sys
import os

DEBUG = "--debug" in sys.argv
SAVE_DIR = os.path.dirname(os.path.abspath(__file__))

def snap(step_name: str):
    if DEBUG:
        path = os.path.join(SAVE_DIR, f"debug_{step_name}.png")
        pyautogui.screenshot(path)
        print(f"  📸 {path}")

def fail(msg: str):
    print(f"\n❌ {msg}")
    snap("fail")
    sys.exit(1)

# ============================================================
# 第 1 步：列所有窗口，找微信
# ============================================================
print("=" * 60)
print("[1/7] 扫描所有窗口...")
print("=" * 60)

all_w = gw.getAllWindows()
wechat_w = None

# 打印所有有标题的窗口用于诊断
print(f"  共 {len(all_w)} 个窗口，正在匹配...")
for w in all_w:
    t = w.title.strip()
    # 宽泛匹配
    if ('微信' in t or 'WeChat' in t or '智了' in t) and w.width > 100:
        wechat_w = w
        print(f"  ✅ 匹配: [{w.width}x{w.height}] vis={w.visible} \"{t[:100]}\"")
        break

if not wechat_w:
    # 兜底：用 win32gui 深度扫描
    try:
        import win32gui
        def enum_cb(hwnd, extra):
            global wechat_w
            if wechat_w:
                return
            title = win32gui.GetWindowText(hwnd)
            cls = win32gui.GetClassName(hwnd)
            rect = win32gui.GetWindowRect(hwnd)
            w = rect[2] - rect[0]
            h = rect[3] - rect[1]
            # 微信类名常见: WeChatMainWndForPC
            if ('WeChat' in cls or 'wechat' in cls.lower() or
                '微信' in title or 'WeChat' in title):
                print(f"  ✅ win32gui 匹配: cls={cls} [{w}x{h}] \"{title[:100]}\"")
                wechat_w = type('obj', (object,), {
                    'hwnd': hwnd,
                    'title': title,
                    'width': w,
                    'height': h,
                    'activate': lambda: win32gui.SetForegroundWindow(hwnd),
                    'isMinimized': win32gui.IsIconic(hwnd),
                    'restore': lambda: win32gui.ShowWindow(hwnd, 9),  # SW_RESTORE
                })()
        win32gui.EnumWindows(enum_cb, None)
    except ImportError:
        print("  ⚠️ win32gui 不可用")

if not wechat_w:
    print("\n  前 40 个可见窗口:")
    count = 0
    for w in all_w:
        t = w.title.strip()
        if t and w.visible:
            print(f"  [{w.width}x{w.height}] \"{t[:120]}\"")
            count += 1
            if count >= 40:
                break

# ============================================================
# 第 2 步：没有窗口就尝试托盘恢复
# ============================================================
if not wechat_w:
    print("\n" + "=" * 60)
    print("[2/7] 未找到微信窗口，尝试从托盘恢复...")
    print("=" * 60)
    print("  方案A: 尝试 Win+3 或 Win+数字键切换...")
    # 常见做法：微信固定在任务栏第3位
    for i in [3, 2, 4, 1, 5]:
        pyautogui.hotkey('win', str(i))
        time.sleep(0.8)
        # 重新扫描
        for w in gw.getAllWindows():
            t = w.title.strip()
            if ('微信' in t or 'WeChat' in t) and w.width > 100:
                wechat_w = w
                print(f"  ✅ Win+{i} 成功！找到: \"{t[:100]}\"")
                break
        if wechat_w:
            break

if not wechat_w:
    print("  方案B: 尝试点击托盘图标区域...")
    # 屏幕右下角托盘区域
    screen_w, screen_h = pyautogui.size()
    # 点击右下角托盘展开按钮
    pyautogui.click(screen_w - 30, screen_h - 30)
    time.sleep(0.5)
    # 尝试在展开区域找微信图标
    pyautogui.click(screen_w - 60, screen_h - 80)
    time.sleep(0.8)
    for w in gw.getAllWindows():
        t = w.title.strip()
        if ('微信' in t or 'WeChat' in t) and w.width > 100:
            wechat_w = w
            print(f"  ✅ 托盘恢复成功: \"{t[:100]}\"")
            break

if not wechat_w:
    fail("找不到微信窗口。请手动把微信窗口打开到桌面，不要最小化，然后重试。")

# ============================================================
# 第 3 步：激活窗口
# ============================================================
print("\n" + "=" * 60)
print("[3/7] 激活微信窗口...")
print("=" * 60)

try:
    if hasattr(wechat_w, 'isMinimized') and wechat_w.isMinimized:
        wechat_w.restore()
        time.sleep(0.5)
    wechat_w.activate()
    time.sleep(0.6)
    print(f"✅ 已激活: {wechat_w.title}")
except Exception as e:
    fail(f"激活失败: {e}")

snap("01_active")

# ============================================================
# 第 4 步：搜索群聊
# ============================================================
print("\n" + "=" * 60)
print("[4/7] 搜索「智了科技」...")
print("=" * 60)

# 确保焦点在微信主窗口，按 Ctrl+F
pyautogui.hotkey('ctrl', 'f')
time.sleep(0.5)
snap("02_search")

# 全选 + 输入
pyautogui.hotkey('ctrl', 'a')
time.sleep(0.1)
pyautogui.write('智了科技', interval=0.06)
time.sleep(1.2)
snap("03_typed")

print("✅ 已输入搜索词")

# ============================================================
# 第 5 步：选中并打开
# ============================================================
print("\n" + "=" * 60)
print("[5/7] 选中搜索结果...")
print("=" * 60)

# 多按几次 Down 确保跳过搜索框
for _ in range(3):
    pyautogui.press('down')
    time.sleep(0.15)

snap("04_selected")
pyautogui.press('enter')
time.sleep(0.8)
snap("05_opened")

print("✅ 已 Enter 打开")

# ============================================================
# 第 6 步：粘贴发送
# ============================================================
print("\n" + "=" * 60)
print("[6/7] 发送消息...")
print("=" * 60)

pyperclip.copy("这是一条来自Loong的测试消息")
time.sleep(0.1)
pyautogui.hotkey('ctrl', 'v')
time.sleep(0.3)
snap("06_pasted")

pyautogui.press('enter')
time.sleep(0.3)
snap("07_sent")

# ============================================================
# 完成
# ============================================================
print("\n" + "=" * 60)
print("[7/7] 🎉 完成！")
print("=" * 60)
print("请切换到微信，确认「智了科技」群里是否收到消息。")
if not DEBUG:
    print(f"\n💡 若失败: python \"{__file__}\" --debug 查看每步截图")
