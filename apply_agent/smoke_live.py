"""Opt-in LIVE smoke test for the browser adapter.

Drives apply_agent's REAL Playwright browser path against a SELF-OWNED form
served on localhost -- no employer, no external network, no real application.
It exercises the full chain that fixture/route-interception tests cannot prove
end to end: open_form -> read_fields -> map_fields -> fill_form (incl. resume
upload) -> submit_form -> is_confirmation / verify_submit.

Run explicitly (it is NOT collected by the pytest suite):

    ./.venv/Scripts/python -m apply_agent.smoke_live

Exit code 0 = the full browser submit path works; non-zero = a stage failed.
"""
import asyncio
import tempfile
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from playwright.async_api import async_playwright

from apply_agent.config import Profile
from apply_agent.browser import open_form, read_fields, fill_form, submit_form, screenshot
from apply_agent.fieldmap import map_fields
from apply_agent.detect import is_confirmation, has_captcha
from apply_agent.graph import verify_submit

FORM_HTML = b"""<!doctype html><html><body>
<h1>Apply for AI Engineer</h1>
<form method="POST" action="/apply" enctype="multipart/form-data">
  <input type="hidden" name="csrf_token" value="xyz">
  <label>First Name <input type="text" name="first_name" required></label>
  <label>Last Name <input type="text" name="last_name" required></label>
  <label>Email <input type="email" name="email" required></label>
  <label>Phone <input type="tel" name="phone"></label>
  <label>Resume <input type="file" name="resume"></label>
  <button type="submit">Submit Application</button>
</form>
</body></html>"""

CONFIRM_HTML = (
    b"<!doctype html><html><body><h1>Thank you for applying!</h1>"
    b"<p>Your application has been received.</p></body></html>"
)


class _Handler(BaseHTTPRequestHandler):
    def log_message(self, *a):  # silence request logging
        pass

    def do_GET(self):
        self.send_response(200)
        self.send_header("Content-Type", "text/html")
        self.end_headers()
        self.wfile.write(FORM_HTML)

    def do_POST(self):
        self.rfile.read(int(self.headers.get("Content-Length", 0)))  # drain body
        self.send_response(200)
        self.send_header("Content-Type", "text/html")
        self.end_headers()
        self.wfile.write(CONFIRM_HTML)


async def run_smoke() -> bool:
    server = ThreadingHTTPServer(("127.0.0.1", 0), _Handler)
    port = server.server_address[1]
    threading.Thread(target=server.serve_forever, daemon=True).start()
    url = f"http://127.0.0.1:{port}/apply"
    print(f"[server] self-owned form at {url}")

    profile = Profile("Samiksha Batra", "smoke@example.com", "9999999999", "http://li/x")
    resume = tempfile.NamedTemporaryFile(suffix=".pdf", delete=False)
    resume.write(b"%PDF-1.4 fake resume")
    resume.close()

    ok = True
    async with async_playwright() as pw:
        browser = await pw.chromium.launch()
        ctx = await browser.new_context()
        try:
            page = await open_form(ctx, url)
            print("[1] open_form            : OK (navigated)")

            fields = await read_fields(page)
            names = [f.name for f in fields]
            print(f"[2] read_fields          : {names}")
            assert "csrf_token" not in names, "hidden field leaked into read_fields"
            assert {"first_name", "last_name", "email"} <= set(names)

            mapping = map_fields(fields, profile)
            print(
                f"[3] map_fields           : values={mapping.values} "
                f"conf={mapping.confidence:.2f} unmapped={mapping.unmapped}"
            )
            assert mapping.confidence >= 0.85, "clean form should clear the auto-submit threshold"

            await fill_form(page, mapping.values, resume.name)
            fn = await page.input_value("[name=first_name]")
            files = await page.locator("input[type=file]").evaluate("el => el.files.length")
            print(f"[4] fill_form            : first_name='{fn}', resume files={files}")
            assert fn == "Samiksha" and files == 1

            print(f"[5] has_captcha          : {has_captcha(await page.content())}")

            await submit_form(page)
            await page.wait_for_load_state("domcontentloaded")
            html = await page.content()
            outcome = verify_submit(html, is_confirmation)
            print(f"[6] submit + verify      : is_confirmation={is_confirmation(html)} -> '{outcome}'")
            assert outcome == "submitted"

            await screenshot(page, resume.name + ".png")
            print("[7] screenshot           : OK")
        except Exception as e:  # noqa: BLE001 - smoke reports any failure
            ok = False
            print(f"[FAIL] {type(e).__name__}: {e}")
        finally:
            await browser.close()
    server.shutdown()
    print("\nRESULT:", "PASS - full browser submit path works end-to-end" if ok else "FAIL")
    return ok


if __name__ == "__main__":
    raise SystemExit(0 if asyncio.run(run_smoke()) else 1)
