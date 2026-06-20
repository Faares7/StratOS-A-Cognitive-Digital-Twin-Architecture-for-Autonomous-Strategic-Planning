import os
import sys
import json
import re
import time
import random
from datetime import datetime, timedelta
from dotenv import load_dotenv
from selenium import webdriver
from selenium.webdriver.common.by import By
from selenium.webdriver.common.keys import Keys
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
from selenium.common.exceptions import (
    NoSuchElementException, TimeoutException, StaleElementReferenceException,
    InvalidSessionIdException, WebDriverException,
)
from pathlib import Path
from keywords import is_relevant, get_matched_categories, get_matched_keywords

# Force UTF-8 output so Arabic text does not crash on Windows cp1252 terminals
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

_HERE = Path(__file__).parent
# Load .env from this directory first, then fall back to project root
load_dotenv(_HERE / ".env")
load_dotenv(_HERE.parent / ".env")

# ── Config ────────────────────────────────────────────────────────────────────
FB_EMAIL        = os.getenv("FB_EMAIL")
FB_PASSWORD     = os.getenv("FB_PASSWORD")
GROUP_URL       = "https://www.facebook.com/groups/1721866421361681"
MAX_POSTS       = 30
MAX_COMMENTS    = 30
MONTHS_BACK     = 6
RAW_DATA_DIR    = str(_HERE / "raw_data")
SESSION_FILE    = str(_HERE / "fb_session.json")
CUTOFF_DATE     = datetime.now() - timedelta(days=MONTHS_BACK * 30)

DATE_SIGNALS = [
    "hr", "min", "just now", "yesterday",
    "january", "february", "march", "april", "may", "june",
    "july", "august", "september", "october", "november", "december",
    "jan", "feb", "mar", "apr", "jun", "jul", "aug",
    "sep", "oct", "nov", "dec", "am", "pm",
]

os.makedirs(RAW_DATA_DIR, exist_ok=True)


# ── Helpers ───────────────────────────────────────────────────────────────────
def human_delay(min_sec=2.0, max_sec=6.0):
    time.sleep(random.uniform(min_sec, max_sec))


def slow_scroll(driver, pixels=400):
    for _ in range(random.randint(3, 6)):
        driver.execute_script(f"window.scrollBy(0, {random.randint(100, pixels)});")
        time.sleep(random.uniform(0.4, 1.2))


def looks_like_date(text: str) -> bool:
    t = text.strip().lower()
    if not t:
        return False
    if len(t) <= 3 and any(c.isdigit() for c in t):
        return True
    if any(sig in t for sig in DATE_SIGNALS):
        return True
    return False


def parse_fb_date(date_str: str) -> datetime | None:
    date_str = date_str.strip()
    now = datetime.now()
    try:
        t = date_str.lower()
        if "hr" in t or "hour" in t:
            return now
        if "min" in t or "just now" in t:
            return now
        if "yesterday" in t:
            return now - timedelta(days=1)
        if len(t) <= 3 and "d" in t and any(c.isdigit() for c in t):
            days = int("".join(filter(str.isdigit, t)))
            return now - timedelta(days=days)
        if len(t) <= 3 and "w" in t and any(c.isdigit() for c in t):
            weeks = int("".join(filter(str.isdigit, t)))
            return now - timedelta(weeks=weeks)
        if len(t) <= 3 and "y" in t and any(c.isdigit() for c in t):
            return None
        for fmt in ("%B %d, %Y", "%B %d", "%b %d, %Y", "%b %d"):
            try:
                parsed = datetime.strptime(date_str, fmt)
                if parsed.year == 1900:
                    parsed = parsed.replace(year=now.year)
                return parsed
            except ValueError:
                continue
    except Exception:
        pass
    return None


def is_within_cutoff(date_str: str) -> bool:
    parsed = parse_fb_date(date_str)
    if parsed is None:
        return True
    return parsed >= CUTOFF_DATE


# ── Driver setup ──────────────────────────────────────────────────────────────
def build_driver(headless: bool = False) -> webdriver.Chrome:
    options = webdriver.ChromeOptions()
    options.add_argument("--no-first-run")
    options.add_argument("--no-default-browser-check")
    options.add_argument("--disable-notifications")
    options.add_argument("--disable-popup-blocking")
    options.add_argument("--disable-blink-features=AutomationControlled")
    options.add_argument("--remote-debugging-port=0")
    options.add_experimental_option("excludeSwitches", ["enable-automation"])
    options.add_experimental_option("useAutomationExtension", False)
    options.add_argument(
        "user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/124.0.0.0 Safari/537.36"
    )
    if headless:
        options.add_argument("--headless=new")
        options.add_argument("--no-sandbox")
        options.add_argument("--disable-gpu")
        options.add_argument("--disable-dev-shm-usage")
        options.add_argument("--window-size=1920,1080")
    else:
        options.add_argument("--start-maximized")
    driver = webdriver.Chrome(options=options)
    driver.execute_script(
        "Object.defineProperty(navigator, 'webdriver', {get: () => undefined})"
    )
    return driver


# ── Session helpers ───────────────────────────────────────────────────────────
def _is_session_valid(driver: webdriver.Chrome) -> bool:
    """Return True if the current browser state is a logged-in Facebook session."""
    url = driver.current_url.lower()
    if "login" in url or "checkpoint" in url or "two_step" in url:
        return False
    try:
        driver.find_element(By.ID, "email")
        return False
    except NoSuchElementException:
        pass
    return True


def _save_session(driver: webdriver.Chrome):
    """Persist browser cookies to SESSION_FILE."""
    try:
        cookies = driver.get_cookies()
        with open(SESSION_FILE, "w", encoding="utf-8") as f:
            json.dump(cookies, f, indent=2)
        print(f"[+] Session cookies saved -> {SESSION_FILE}")
    except Exception as e:
        print(f"[!] Could not save session: {e}")


def _load_session(driver: webdriver.Chrome) -> bool:
    """
    Load cookies from SESSION_FILE and verify the session is still active.
    Returns True if a valid session was restored, False otherwise.
    """
    if not os.path.exists(SESSION_FILE):
        print("[*] No saved session found.")
        return False
    try:
        with open(SESSION_FILE, encoding="utf-8") as f:
            cookies = json.load(f)
        # Navigate to domain before injecting cookies (browser requirement)
        driver.get("https://www.facebook.com")
        human_delay(2, 3)
        for cookie in cookies:
            try:
                driver.add_cookie(cookie)
            except Exception:
                pass
        # Reload to apply cookies
        driver.get("https://www.facebook.com")
        human_delay(3, 5)
        if _is_session_valid(driver):
            print("[+] Session restored from saved cookies — skipping login.")
            return True
        print("[!] Saved session has expired — will log in fresh.")
        return False
    except Exception as e:
        print(f"[!] Failed to load session: {e}")
        return False


# ── Login ─────────────────────────────────────────────────────────────────────
def login(driver: webdriver.Chrome, verification_wait: int = 90):
    """
    1. Try to restore a saved session (cookies) — skips login + 2FA entirely.
    2. If no valid session, do credential login and wait for any 2FA.
    3. After a successful fresh login, save cookies for future runs.
    """
    if _load_session(driver):
        return  # session restored, nothing else to do

    print("[*] Logging in with credentials from .env ...")
    driver.get("https://www.facebook.com")
    human_delay(3, 5)

    try:
        WebDriverWait(driver, 10).until(
            EC.presence_of_element_located((By.ID, "email"))
        )
        driver.find_element(By.ID, "email").send_keys(FB_EMAIL)
        human_delay(0.5, 1.5)
        driver.find_element(By.ID, "pass").send_keys(FB_PASSWORD)
        human_delay(0.5, 1.5)
        driver.find_element(By.ID, "pass").send_keys(Keys.RETURN)
        human_delay(4, 7)
        print("[+] Credentials submitted.")
    except TimeoutException:
        print("[!] Login form not found — may already be logged in.")

    # Give time to complete any 2FA challenge that Facebook shows
    if verification_wait > 0:
        print(f"\n[!] FIRST-TIME SETUP: If Facebook shows a verification step, complete it now.")
        print(f"[!] You have {verification_wait} seconds. After this run, cookies are saved")
        print(f"[!] and future runs will NOT need any manual interaction.\n")
        time.sleep(verification_wait)

    # Save cookies so the next run skips login entirely
    if _is_session_valid(driver):
        _save_session(driver)
        print("[+] Login successful — session saved for future automated runs.")
    else:
        print("[!] Warning: session does not appear valid after login wait.")

    print("[*] Continuing to group...")


# ── Extract post text ─────────────────────────────────────────────────────────
def extract_post_text(post_el) -> str | None:
    for attr in ["data-ad-comet-preview='message'", "data-ad-preview='message'"]:
        try:
            el = post_el.find_element(By.XPATH, f".//div[@{attr}]")
            text = el.text.strip()
            if text:
                return text
        except (NoSuchElementException, StaleElementReferenceException):
            pass

    try:
        el = post_el.find_element(
            By.XPATH, ".//div[contains(@class,'userContent')]"
        )
        text = el.text.strip()
        if text:
            return text
    except (NoSuchElementException, StaleElementReferenceException):
        pass

    try:
        els = post_el.find_elements(By.XPATH, ".//div[@dir='auto']")
        for el in els:
            text = el.text.strip()
            if text and len(text) > 20:
                return text
    except (NoSuchElementException, StaleElementReferenceException):
        pass

    return None


# ── Extract date ──────────────────────────────────────────────────────────────
def extract_date(post_el) -> str:
    """
    Tries multiple XPath strategies covering old (/posts/) and current
    (/permalink/) Facebook URL formats. Also checks title and aria-label
    attributes which often carry the full date even when visible text is relative.
    """
    xpaths = [
        ".//abbr",
        ".//a[contains(@href,'/permalink/')]//span",
        ".//a[contains(@href,'/groups/') and contains(@href,'/permalink/')]//span",
        ".//a[contains(@href,'/permalink/')]",
        ".//a[contains(@href,'/posts/')]//span",
        ".//a[contains(@href,'/groups/') and contains(@href,'/posts/')]//span",
        ".//span[contains(@aria-label,'ago') or contains(@aria-label,'at')]",
        ".//a[@aria-label]",
    ]
    for xpath in xpaths:
        try:
            candidates = post_el.find_elements(By.XPATH, xpath)
            for el in candidates:
                try:
                    for value in [
                        el.text.strip(),
                        el.get_attribute("title") or "",
                        el.get_attribute("aria-label") or "",
                    ]:
                        if value and looks_like_date(value):
                            return value
                except StaleElementReferenceException:
                    continue
        except (NoSuchElementException, StaleElementReferenceException):
            pass
    return "unknown"


# ── Extract likes / reaction count ───────────────────────────────────────────
def extract_likes(container) -> int:
    """
    Multi-strategy reaction count extraction covering old and new Facebook DOM.
    Tries element text first, then aria-label attribute.
    """
    xpaths = [
        ".//*[contains(@aria-label,'reacted')]",
        ".//*[contains(@aria-label,'reaction')]",
        ".//*[contains(@aria-label,'like') or contains(@aria-label,'Like')]",
    ]
    for xpath in xpaths:
        try:
            els = container.find_elements(By.XPATH, xpath)
            for el in els:
                digits = re.sub(r"[^\d]", "", el.text)
                if digits:
                    return int(digits)
                label = el.get_attribute("aria-label") or ""
                m = re.search(r"\d[\d,]*", label)
                if m:
                    return int(m.group().replace(",", ""))
        except (NoSuchElementException, StaleElementReferenceException):
            continue
    return 0


def extract_comment_count(post_el) -> int:
    """Multi-strategy comment count extraction."""
    xpaths = [
        ".//span[contains(@aria-label,'comment')]",
        ".//div[contains(@aria-label,'comment')]",
        ".//a[contains(@aria-label,'comment')]",
        ".//span[contains(text(),'comment') or contains(text(),'Comment')]",
    ]
    for xpath in xpaths:
        try:
            els = post_el.find_elements(By.XPATH, xpath)
            for el in els:
                digits = re.sub(r"[^\d]", "", el.text)
                if digits:
                    return int(digits)
                label = el.get_attribute("aria-label") or ""
                m = re.search(r"\d[\d,]*", label)
                if m:
                    return int(m.group().replace(",", ""))
        except (NoSuchElementException, StaleElementReferenceException):
            continue
    return 0


# ── Comment scraper ───────────────────────────────────────────────────────────
def scrape_comments(driver: webdriver.Chrome) -> list[dict]:
    comments = []
    try:
        for _ in range(3):
            try:
                more_btn = driver.find_element(
                    By.XPATH,
                    "//span[contains(text(),'View more comments') or "
                    "contains(text(),'View') and contains(text(),'comment')]"
                )
                driver.execute_script("arguments[0].click();", more_btn)
                human_delay(1.5, 3.0)
            except (NoSuchElementException, StaleElementReferenceException):
                break

        comment_elements = []
        for xpath in [
            "//div[@aria-label='Comment']",
            "//div[@role='article']//div[@dir='auto']",
            "//ul//li//div[@dir='auto']",
        ]:
            comment_elements = driver.find_elements(By.XPATH, xpath)
            if comment_elements:
                break

        for el in comment_elements[:MAX_COMMENTS]:
            try:
                text = el.text.strip()
                if not text or len(text) < 5:
                    continue

                comment_likes = extract_likes(el)

                comments.append({
                    "text":               text,
                    "likes":              comment_likes,
                    "relevant":           is_relevant(text),
                    "matched_categories": get_matched_categories(text),
                    "matched_keywords":   get_matched_keywords(text),
                })
            except StaleElementReferenceException:
                continue

    except Exception as e:
        print(f"    [!] Comment scrape error: {e}")

    return comments


# ── Post scraper ──────────────────────────────────────────────────────────────
def scrape_group(driver: webdriver.Chrome) -> list[dict]:
    print(f"[*] Navigating to group: {GROUP_URL}")
    driver.get(GROUP_URL)
    human_delay(5, 8)
    print(f"[*] Current URL  : {driver.current_url}")
    print(f"[*] Page title   : {driver.title}")

    posts_collected = []
    seen_texts      = set()
    consecutive_old = 0
    scroll_attempts = 0
    max_scrolls     = 30

    print(f"[*] Starting scrape - target: {MAX_POSTS} posts | last {MONTHS_BACK} months\n")

    try:
        while len(posts_collected) < MAX_POSTS and scroll_attempts < max_scrolls:

            post_elements = []
            for xpath in [
                "//div[@data-pagelet='GroupFeed']//div[@role='article' and @aria-posinset]",
                "//div[@role='feed']//div[@role='article' and @aria-posinset]",
                "//div[@role='article' and @aria-posinset]",
                "//div[@data-pagelet='GroupFeed']//div[@role='article']",
                "//div[@role='feed']//div[@role='article']",
            ]:
                post_elements = driver.find_elements(By.XPATH, xpath)
                if post_elements:
                    break

            print(f"[*] Scroll {scroll_attempts:02d} - "
                  f"{len(post_elements)} elements visible | "
                  f"{len(posts_collected)} collected so far")

            for post_el in post_elements:
                if len(posts_collected) >= MAX_POSTS:
                    break

                try:
                    try:
                        see_more = post_el.find_element(
                            By.XPATH,
                            ".//div[contains(text(),'See more')] | "
                            ".//span[contains(text(),'See more')]"
                        )
                        driver.execute_script("arguments[0].click();", see_more)
                        human_delay(0.3, 0.8)
                    except (NoSuchElementException, StaleElementReferenceException):
                        pass

                    text = extract_post_text(post_el)
                    if not text or len(text) < 10:
                        continue

                    text_key = text[:80]
                    if text_key in seen_texts:
                        continue
                    seen_texts.add(text_key)

                    date_str = extract_date(post_el)
                    print(f"    [date] '{date_str}'")

                    if date_str != "unknown" and not is_within_cutoff(date_str):
                        consecutive_old += 1
                        print(f"    [skip] outside cutoff ({consecutive_old}/5)")
                        if consecutive_old >= 5:
                            print("[*] 5 consecutive old posts - stopping.")
                            return posts_collected
                        continue
                    else:
                        consecutive_old = 0

                    likes         = extract_likes(post_el)
                    comment_count = extract_comment_count(post_el)

                    print(f"    [post] likes={likes} comments={comment_count} "
                          f"text_len={len(text)} text='{text[:60]}'")

                    relevant     = is_relevant(text)
                    matched_cats = get_matched_categories(text)
                    matched_kws  = get_matched_keywords(text)

                    comments = []
                    if relevant:
                        try:
                            post_link_el = post_el.find_element(
                                By.XPATH,
                                ".//a[contains(@href,'/groups/') and "
                                "contains(@href,'/posts/')]"
                            )
                            post_url = post_link_el.get_attribute("href")
                            driver.execute_script(
                                f"window.open('{post_url}', '_blank');"
                            )
                            driver.switch_to.window(driver.window_handles[-1])
                            human_delay(3, 5)
                            comments = scrape_comments(driver)
                            driver.close()
                            driver.switch_to.window(driver.window_handles[0])
                            human_delay(2, 4)
                        except Exception as e:
                            print(f"    [!] Could not open post for comments: {e}")

                    record = {
                        "post_text":          text,
                        "date_str":           date_str,
                        "likes":              likes,
                        "comment_count":      comment_count,
                        "relevant":           relevant,
                        "matched_categories": matched_cats,
                        "matched_keywords":   matched_kws,
                        "comments":           comments,
                        "source_group":       "Nile University Friends in Egypt",
                        "source_university":  "Nile University",
                        "scraped_at":         datetime.now().isoformat(),
                    }

                    posts_collected.append(record)
                    status = "RELEVANT  " if relevant else "irrelevant"
                    print(f"  [{len(posts_collected):03d}] {status} | "
                          f"likes={likes:>3} | comments={len(comments):>2} | "
                          f"{text[:55]}...")

                except StaleElementReferenceException:
                    print("    [!] Stale element - skipping post")
                    continue

            slow_scroll(driver, pixels=600)
            human_delay(2.5, 5.0)
            scroll_attempts += 1

    except (InvalidSessionIdException, WebDriverException) as browser_err:
        print(f"\n[!] Browser disconnected: {browser_err}")
        print(f"[!] Returning {len(posts_collected)} posts collected before disconnect.")

    return posts_collected


# ── Save ──────────────────────────────────────────────────────────────────────
def save(posts: list[dict]) -> str:
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    path = os.path.join(RAW_DATA_DIR, f"scraped_{timestamp}.json")
    with open(path, "w", encoding="utf-8") as f:
        json.dump(posts, f, ensure_ascii=False, indent=2)

    relevant_count = sum(1 for p in posts if p["relevant"])
    print(f"\n[+] Saved {len(posts)} posts -> {path}")
    print(f"    Relevant : {relevant_count}")
    print(f"    Filtered : {len(posts) - relevant_count}")
    return path


# ── Callable entry point ───────────────────────────────────────────────────────
def run_scrape(headless: bool = False, verification_wait: int = 90) -> str | None:
    """
    Run the full scrape pipeline.

    On first run (no fb_session.json): opens browser, logs in with .env credentials,
    waits `verification_wait` seconds for any 2FA, then saves cookies.

    On subsequent runs: restores cookies silently — no manual interaction needed.

    Returns the path to the saved JSON file.
    """
    driver = build_driver(headless=headless)
    posts  = []
    path   = None
    try:
        login(driver, verification_wait=verification_wait)
        posts = scrape_group(driver)
        if posts:
            path = save(posts)
    except KeyboardInterrupt:
        print("\n[!] Interrupted - saving what was collected...")
        if posts:
            path = save(posts)
    except Exception as exc:
        print(f"\n[!] Scrape error: {exc}")
        if posts:
            print(f"[!] Saving {len(posts)} posts collected before error...")
            path = save(posts)
    finally:
        try:
            driver.quit()
        except Exception:
            pass
        print("[*] Browser closed.")
    return path


# ── Main ──────────────────────────────────────────────────────────────────────
def main():
    run_scrape(headless=False, verification_wait=90)


if __name__ == "__main__":
    main()