# apply_agent/tests/test_browser.py
import pathlib
import pytest
from playwright.async_api import async_playwright
from apply_agent.browser import read_fields, fill_form

FIX = pathlib.Path(__file__).parent / "fixtures" / "greenhouse_form.html"


async def _page():
    pw = await async_playwright().start()
    browser = await pw.chromium.launch()
    ctx = await browser.new_context()
    page = await ctx.new_page()
    await page.route("**/*", lambda route: route.fulfill(body=FIX.read_text(), content_type="text/html"))
    await page.goto("https://boards.greenhouse.io/acme/jobs/1")
    return pw, browser, page


@pytest.mark.asyncio
async def test_reads_named_inputs_from_the_form():
    pw, browser, page = await _page()
    try:
        names = {f.name for f in await read_fields(page)}
        assert {"first_name", "last_name", "email"} <= names
    finally:
        await browser.close(); await pw.stop()


@pytest.mark.asyncio
async def test_fill_sets_input_values():
    pw, browser, page = await _page()
    try:
        await fill_form(page, {"first_name": "Samiksha", "email": "me@x.com"}, resume_path=None)
        assert await page.input_value("[name=first_name]") == "Samiksha"
    finally:
        await browser.close(); await pw.stop()


@pytest.mark.asyncio
async def test_read_fields_skips_hidden_inputs():
    pw, browser, page = await _page()
    try:
        names = {f.name for f in await read_fields(page)}
        assert "csrf_token" not in names
        assert {"first_name", "last_name", "email"} <= names
    finally:
        await browser.close(); await pw.stop()


@pytest.mark.asyncio
async def test_fill_form_uploads_resume(tmp_path):
    resume = tmp_path / "resume.pdf"
    resume.write_bytes(b"%PDF-1.4 fake resume content")

    pw, browser, page = await _page()
    try:
        await fill_form(page, {"first_name": "Samiksha"}, resume_path=str(resume))
        file_count = await page.locator("input[type=file]").first.evaluate("el => el.files.length")
        file_name = await page.locator("input[type=file]").first.evaluate("el => el.files[0].name")
        assert file_count == 1
        assert file_name == "resume.pdf"
    finally:
        await browser.close(); await pw.stop()


# --- React-shaped forms: identity in `id`/`aria-label`, no `name` ------------
# The live run against PhonePe filled nothing: read_fields required a `name`
# attribute and only 2 of the form's 50 fields had one.

REACT_FIX = pathlib.Path(__file__).parent / "fixtures" / "greenhouse_form_react.html"


async def _react_page():
    pw = await async_playwright().start()
    browser = await pw.chromium.launch()
    ctx = await browser.new_context()
    page = await ctx.new_page()
    await page.route("**/*", lambda route: route.fulfill(body=REACT_FIX.read_text(), content_type="text/html"))
    await page.goto("https://job-boards.greenhouse.io/acme/jobs/1")
    return pw, browser, page


@pytest.mark.asyncio
async def test_reads_id_only_inputs():
    pw, browser, page = await _react_page()
    try:
        keys = {f.key for f in await read_fields(page)}
        assert {"first_name", "last_name", "email", "phone"} <= keys
    finally:
        await browser.close(); await pw.stop()


@pytest.mark.asyncio
async def test_still_skips_hidden_inputs_without_a_name():
    pw, browser, page = await _react_page()
    try:
        keys = {f.key for f in await read_fields(page)}
        assert "csrf_token" not in keys
    finally:
        await browser.close(); await pw.stop()


@pytest.mark.asyncio
async def test_prefers_name_over_id_when_both_exist():
    pw, browser, page = await _react_page()
    try:
        keys = {f.key for f in await read_fields(page)}
        assert "notice_period" in keys
    finally:
        await browser.close(); await pw.stop()


@pytest.mark.asyncio
async def test_aria_label_becomes_the_label_for_id_only_fields():
    pw, browser, page = await _react_page()
    try:
        by_key = {f.key: f for f in await read_fields(page)}
        assert by_key["first_name"].label == "First Name"
    finally:
        await browser.close(); await pw.stop()


@pytest.mark.asyncio
async def test_fill_sets_values_on_id_only_inputs():
    pw, browser, page = await _react_page()
    try:
        await fill_form(page, {"first_name": "Samiksha", "email": "me@x.com"}, resume_path=None)
        assert await page.input_value("#first_name") == "Samiksha"
        assert await page.input_value("#email") == "me@x.com"
    finally:
        await browser.close(); await pw.stop()


@pytest.mark.asyncio
async def test_fill_still_works_on_named_inputs():
    pw, browser, page = await _react_page()
    try:
        await fill_form(page, {"notice_period": "30 days"}, resume_path=None)
        assert await page.input_value("[name=notice_period]") == "30 days"
    finally:
        await browser.close(); await pw.stop()


@pytest.mark.asyncio
async def test_aria_required_counts_as_required():
    """`unmapped` is one of the two gates that force manual review, and it is
    fed only by fields marked required. React forms mark most of theirs with
    aria-required rather than the `required` attribute -- 26 vs 12 on the live
    PhonePe posting -- so reading only `required` left required questions
    invisible to the gate."""
    pw, browser, page = await _react_page()
    try:
        by_key = {f.key: f for f in await read_fields(page)}
        assert by_key["notice_period_q"].required is True
        assert by_key["expected_ctc"].required is True     # plain `required` still works
        assert by_key["phone"].required is False           # neither marker -> not required
    finally:
        await browser.close(); await pw.stop()
