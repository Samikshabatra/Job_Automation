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
